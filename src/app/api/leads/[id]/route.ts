import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canEditLead, isLeadViewAdmin } from "@/lib/leads/access";
import { resolveEventByName } from "@/lib/leads/events";
import { isLeadOwnerOrAssistant } from "@/lib/leads/membership";
import { buildLeadPatch } from "@/lib/leads/patch";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import type { LeadRow } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTableColumnsWithOptions } from "@/lib/table-config/queries";
import { coerceCustomValue } from "@/lib/table-config/values";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LEAD_SELECT =
  "id,display_number,product,event_id,full_name,phone,email," +
  "assigned_to_email,assigned_at,assigned_by_email,status_id," +
  "first_contacted_at,last_contacted_at,contact_attempt_count," +
  "next_follow_up_at,closed_at,created_by_email,created_at," +
  "updated_by_email,updated_at,custom_values,archived_at,lead_events(name)";

function withEventName(row: unknown): LeadRow {
  const source = row as LeadRow & { lead_events?: { name?: string | null } | null };
  const { lead_events, ...lead } = source;
  return { ...lead, event_name: lead_events?.name?.trim() || null };
}

/**
 * Inline edits from the table. Deliberately narrower than it looks: assignment
 * has its own route because it writes a history row, and the four contact
 * counters are written only by log_lead_interaction_atomic.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 });
  }

  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  const supabase = getSupabaseAdmin();
  const { data: current, error: currentError } = await supabase
    .from("leads")
    .select("id,assigned_to_email,status_id,next_follow_up_at,custom_values")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (currentError) {
    return NextResponse.json({ error: currentError.message }, { status: 500 });
  }
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const lead = current as Pick<LeadRow, "assigned_to_email">;
  // Only ask agent_members when the answer can still change.
  const isOwnerOrAssistant = actor.isManager
    ? false
    : await isLeadOwnerOrAssistant(lead.assigned_to_email, email);
  if (!canEditLead(actor, lead, { isOwnerOrAssistant })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = buildLeadPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const patch: Record<string, unknown> = { ...parsed.patch };

  // A status change carries the same rule log_lead_interaction_atomic enforces:
  // a "Call back" without a date would sit in the alert engine as a follow-up
  // that can never come due, and a lead moved to Won while a follow-up is still
  // pending keeps showing as overdue for a call nobody owes.
  if (patch.status_id !== undefined && patch.status_id !== null) {
    const { data: status, error: statusError } = await supabase
      .from("lead_statuses")
      .select("kind")
      .eq("id", patch.status_id as string)
      .is("archived_at", null)
      .maybeSingle();
    if (statusError) {
      return NextResponse.json({ error: statusError.message }, { status: 500 });
    }
    if (!status) {
      return NextResponse.json({ error: "That status no longer exists." }, { status: 400 });
    }
    const nextFollowUp =
      patch.next_follow_up_at !== undefined
        ? patch.next_follow_up_at
        : (current as { next_follow_up_at: string | null }).next_follow_up_at;
    if (status.kind === "scheduled" && !nextFollowUp) {
      return NextResponse.json(
        { error: "That status needs a follow-up date. Open the lead to log it." },
        { status: 400 }
      );
    }
    if (status.kind !== "scheduled") patch.next_follow_up_at = null;
  }

  if (parsed.eventName !== undefined) {
    if (parsed.eventName === null) {
      patch.event_id = null;
    } else {
      const resolved = await resolveEventByName(supabase, parsed.eventName, email);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 500 });
      }
      patch.event_id = resolved.id;
    }
  }

  if (parsed.customValues) {
    const config = await fetchTableColumnsWithOptions("lead", supabase);
    const merged: Record<string, unknown> = {
      ...((current as { custom_values?: Record<string, unknown> }).custom_values ?? {}),
    };
    for (const [key, raw] of Object.entries(parsed.customValues)) {
      const column = config.columns.find(
        (candidate) => candidate.key === key && !candidate.archived_at
      );
      if (!column) {
        return NextResponse.json({ error: `Unknown column ${key}.` }, { status: 400 });
      }
      const optionIds = new Set(
        config.options
          .filter((option) => option.column_id === column.id && !option.archived_at)
          .map((option) => option.id)
      );
      const coerced = coerceCustomValue(column.type, raw, { optionIds });
      if (!coerced.ok) {
        return NextResponse.json({ error: coerced.error }, { status: 400 });
      }
      merged[key] = coerced.value;
    }
    patch.custom_values = merged;
  }

  patch.updated_by_email = email;
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", id)
    .is("archived_at", null)
    .select(LEAD_SELECT)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sourceId = readLeadMutationSourceId(request);
  after(async () => {
    await broadcastLeadsChanged(sourceId);
  });
  return NextResponse.json({ lead: withEventName(data) });
}

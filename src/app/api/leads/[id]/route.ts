import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, isLeadViewAdmin } from "@/lib/leads/access";
import { resolveLeadCapabilities } from "@/lib/leads/capabilities";
import { resolveEventByName } from "@/lib/leads/events";
import { isLeadOwnerOrAssistant } from "@/lib/leads/membership";
import { buildLeadPatch, checkFollowUpInvariant } from "@/lib/leads/patch";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import type { LeadRow } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";
import { validateCustomValues } from "@/lib/table-config/custom-values";
import { findMissingRequiredFieldsFromContext } from "@/lib/table-config/required";
import {
  fetchWriteValidationContext,
  TableConfigUnavailableError,
} from "@/lib/table-config/write-context";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LEAD_SELECT =
  "id,display_number,product,products,event_id,full_name,phone,email," +
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
  if (!resolveLeadCapabilities(actor, lead, { isOwnerOrAssistant }).canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = buildLeadPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const patch: Record<string, unknown> = { ...parsed.patch };

  // The status/follow-up invariant runs whenever EITHER side of it can change,
  // not only when a status is sent: a request carrying just next_follow_up_at
  // used to slip through and hang a date on a lead whose status cannot carry
  // one. See checkFollowUpInvariant for what each direction costs.
  const currentRow = current as {
    next_follow_up_at: string | null;
    status_id: string | null;
    custom_values?: Record<string, unknown>;
  };
  const statusTouched = patch.status_id !== undefined;
  const followUpTouched = patch.next_follow_up_at !== undefined;
  if (statusTouched || followUpTouched) {
    const nextStatusId = (
      statusTouched ? patch.status_id : currentRow.status_id
    ) as string | null;

    let nextStatusKind: "open" | "scheduled" | "won" | "lost" | null = null;
    if (nextStatusId) {
      const { data: status, error: statusError } = await supabase
        .from("lead_statuses")
        .select("kind")
        .eq("id", nextStatusId)
        .is("archived_at", null)
        .maybeSingle();
      if (statusError) {
        return NextResponse.json({ error: statusError.message }, { status: 500 });
      }
      // Only a status the caller is SETTING has to still exist. A lead already
      // pointing at an archived status must stay editable, or archiving one
      // status would freeze every lead that ever used it.
      if (!status) {
        if (statusTouched) {
          return NextResponse.json({ error: "That status no longer exists." }, { status: 400 });
        }
      } else {
        nextStatusKind = status.kind as typeof nextStatusKind;
      }
    }

    const nextFollowUpAt = (
      followUpTouched ? patch.next_follow_up_at : currentRow.next_follow_up_at
    ) as string | null;
    const invariant = checkFollowUpInvariant({
      nextStatusKind,
      nextFollowUpAt,
      followUpTouched,
    });
    if (!invariant.ok) {
      return NextResponse.json({ error: invariant.error }, { status: 400 });
    }
    if (invariant.clearFollowUp) patch.next_follow_up_at = null;
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

  // Same validation context Task and Enrollment use: one RPC returns the active
  // columns, their options, and the person emails that actually matched, so
  // Create / Import / inline edit cannot end up with three different contracts
  // for the same column.
  // `products` is the internal multi-product representation, not a configured
  // table column. Keep it out of table-config validation while still allowing
  // the DB trigger to derive the legacy primary `product` column from it.
  const touchedSystemKeys = Object.keys(parsed.patch).filter(
    (key) => key !== "products",
  );
  const submittedCustomValues = parsed.customValues ?? {};
  let writeContext;
  try {
    writeContext = await fetchWriteValidationContext(
      {
        scope: "lead",
        mode: "patch",
        touchedSystemKeys,
        touchedCustomKeys: Object.keys(submittedCustomValues),
        submittedCustomValues,
      },
      supabase
    );
  } catch (error) {
    if (error instanceof TableConfigUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  if (parsed.customValues) {
    const validated = validateCustomValues(parsed.customValues, writeContext);
    if (!validated.ok) {
      const first = validated.issues[0];
      return NextResponse.json(
        { error: `${first.key}: ${first.reason.replace(/-/g, " ")}.` },
        { status: 400 }
      );
    }
    patch.custom_values = {
      ...(currentRow.custom_values ?? {}),
      ...validated.values,
    };
  }

  // partial: true — only required fields this request actually touches are
  // checked, so an edit that never mentions them is not blocked. Without this
  // an inline edit could empty a column an admin marked Required, something
  // Create has always refused.
  const missingRequired = findMissingRequiredFieldsFromContext(writeContext, {
    fieldValues: {
      name: parsed.patch.full_name,
      phone: parsed.patch.phone,
      email: parsed.patch.email,
      product: parsed.patch.product,
      status: parsed.patch.status_id,
      ...(parsed.eventName !== undefined ? { event: parsed.eventName } : {}),
    },
    customValues: parsed.customValues ?? null,
    partial: true,
  });
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: `${missingRequired.map((field) => field.label).join(", ")} required.` },
      { status: 400 }
    );
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
    await broadcastLeadsChanged(sourceId, [id]);
  });
  return NextResponse.json({ lead: withEventName(data) });
}

import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { canBeAssignedLead } from "@/lib/leads/assign-target";
import { validateAssignRequest } from "@/lib/leads/assign";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import type { LeadRow } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const LEAD_AFTER_SELECT =
  "id,display_number,product,products,event_id,full_name,phone,email," +
  "assigned_to_email,assigned_at,assigned_by_email,status_id," +
  "first_contacted_at,last_contacted_at,contact_attempt_count," +
  "next_follow_up_at,closed_at,created_by_email,created_at," +
  "updated_by_email,updated_at,custom_values,archived_at,lead_events(name)";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = validateAssignRequest(
    (await request.json().catch(() => null)) as Record<string, unknown> | null
  );
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (parsed.toEmail) {
    const targetAccess = await getUserAccessByEmail(parsed.toEmail);
    if (!canBeAssignedLead(targetAccess)) {
      return NextResponse.json({ error: "That person cannot be assigned leads." }, { status: 400 });
    }
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data: before, error: beforeError } = await supabase
    .from("leads")
    .select("id,assigned_to_email")
    .in("id", parsed.leadIds)
    .is("archived_at", null);
  if (beforeError) return NextResponse.json({ error: beforeError.message }, { status: 500 });
  const rows = (before ?? []) as { id: string; assigned_to_email: string | null }[];
  if (rows.length === 0) return NextResponse.json({ error: "No active leads were found." }, { status: 404 });

  const { error: updateError } = await supabase
    .from("leads")
    .update({
      assigned_to_email: parsed.toEmail,
      assigned_at: parsed.toEmail ? nowIso : null,
      assigned_by_email: actor.email.trim().toLowerCase(),
      updated_at: nowIso,
      updated_by_email: actor.email.trim().toLowerCase(),
    })
    .in("id", rows.map((row) => row.id))
    .is("archived_at", null);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const { error: historyError } = await supabase
    .from("lead_assignment_history")
    .insert(rows.map((row) => ({
      lead_id: row.id,
      from_email: row.assigned_to_email,
      to_email: parsed.toEmail,
      reason: parsed.reason,
      actor_email: actor.email.trim().toLowerCase(),
    })));
  if (historyError) {
    console.error("Lead assignment history insert failed", historyError.message);
  }

  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId, rows.map((row) => row.id)); });
  // Trả về chính những dòng vừa đổi để màn hình vá tại chỗ. Trước đây chỉ trả
  // số lượng, nên gán MỘT lead cũng buộc client kéo lại toàn bộ danh sách.
  const { data: updated, error: afterError } = await supabase
    .from("leads")
    .select(LEAD_AFTER_SELECT)
    .in("id", rows.map((row) => row.id));
  if (afterError) return NextResponse.json({ error: afterError.message }, { status: 500 });
  return NextResponse.json({
    assigned: rows.length,
    leads: (updated ?? []).map((row) => {
      const lead = row as unknown as LeadRow & {
        lead_events?: { name?: string | null } | null;
      };
      const { lead_events, ...rest } = lead;
      return { ...rest, event_name: lead_events?.name?.trim() || null };
    }),
  });
}

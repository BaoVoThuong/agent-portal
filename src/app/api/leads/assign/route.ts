import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { canBeAssignedLead } from "@/lib/leads/assign-target";
import { validateAssignRequest } from "@/lib/leads/assign";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
  after(async () => { await broadcastLeadsChanged(sourceId); });
  return NextResponse.json({ assigned: rows.length });
}

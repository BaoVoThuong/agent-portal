import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, isLeadViewAdmin } from "@/lib/leads/access";
import { resolveLeadCapabilities } from "@/lib/leads/capabilities";
import { isLeadOwnerOrAssistant } from "@/lib/leads/membership";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import type { LeadRow } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid lead id." }, { status: 400 });

  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  const supabase = getSupabaseAdmin();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id,assigned_to_email")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const viewed = lead as Pick<LeadRow, "assigned_to_email">;
  const canSeeAsAssistant = actor.isManager
    ? false
    : await isLeadOwnerOrAssistant(viewed.assigned_to_email, email);
  if (!resolveLeadCapabilities(actor, viewed, { isOwnerOrAssistant: canSeeAsAssistant }).canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("lead_interactions")
    .select("id,lead_id,type_id,status_id,note,actor_email,occurred_at,follow_up_at,created_at")
    .eq("lead_id", id)
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ interactions: data ?? [] });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid lead id." }, { status: 400 });

  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  const supabase = getSupabaseAdmin();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id,assigned_to_email")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (leadError) {
    return NextResponse.json({ error: leadError.message }, { status: 500 });
  }
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const target = lead as Pick<LeadRow, "assigned_to_email">;
  // An Assistant logs calls on their agent's leads; that is the point of the
  // pairing. Ownership is unchanged, so the contact counters still belong to
  // the agent the lead is assigned to.
  const isOwnerOrAssistant = await isLeadOwnerOrAssistant(
    target.assigned_to_email,
    email,
  );
  if (!resolveLeadCapabilities(actor, target, { isOwnerOrAssistant }).canLog) {
    return NextResponse.json(
      { error: "This lead is not assigned to you." },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const typeId = typeof body?.type_id === "string" ? body.type_id : "";
  if (!UUID_RE.test(typeId)) {
    return NextResponse.json({ error: "type_id is required." }, { status: 400 });
  }
  const rawStatusId = body?.status_id;
  if (rawStatusId !== undefined && rawStatusId !== null && rawStatusId !== "" &&
      (typeof rawStatusId !== "string" || !UUID_RE.test(rawStatusId))) {
    return NextResponse.json({ error: "status_id must be a valid UUID." }, { status: 400 });
  }
  const statusId = typeof rawStatusId === "string" && rawStatusId !== "" ? rawStatusId : null;

  const rawRequestId = body?.client_request_id;
  if (rawRequestId !== undefined && rawRequestId !== null && rawRequestId !== "" &&
      (typeof rawRequestId !== "string" || !UUID_RE.test(rawRequestId))) {
    return NextResponse.json({ error: "client_request_id must be a valid UUID." }, { status: 400 });
  }
  const requestId = typeof rawRequestId === "string" && rawRequestId !== "" ? rawRequestId : null;

  const rawFollowUpAt = body?.follow_up_at;
  if (rawFollowUpAt !== undefined && rawFollowUpAt !== null && rawFollowUpAt !== "" &&
      (typeof rawFollowUpAt !== "string" || !Number.isFinite(Date.parse(rawFollowUpAt)))) {
    return NextResponse.json({ error: "follow_up_at must be a valid date." }, { status: 400 });
  }
  const followUpAt = typeof rawFollowUpAt === "string" && rawFollowUpAt !== "" ? rawFollowUpAt : null;

  const { data, error } = await supabase
    .rpc("log_lead_interaction_atomic", {
      p_lead_id: id,
      p_type_id: typeId,
      p_status_id: statusId,
      p_note: typeof body?.note === "string" ? body.note : null,
      p_actor_email: actor.email,
      p_follow_up_at: followUpAt,
      p_client_request_id: requestId,
    })
    .single();

  if (error) {
    const errors: Record<string, [string, number]> = {
      LEAD_NOT_FOUND: ["Not found", 404],
      LEAD_TYPE_NOT_FOUND: ["That interaction type no longer exists.", 400],
      LEAD_STATUS_NOT_FOUND: ["That status no longer exists.", 400],
      LEAD_FOLLOW_UP_REQUIRED: [
        "Pick the date and time you promised to call back.",
        400,
      ],
      LEAD_FOLLOW_UP_REQUIRES_SCHEDULED: [
        "Only a call-back status can carry a follow-up time.",
        400,
      ],
    };
    const match = Object.entries(errors).find(([code]) => error.message.includes(code));
    if (match) {
      const [message, status] = match[1];
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sourceId = readLeadMutationSourceId(req);
  after(async () => {
    await broadcastLeadsChanged(sourceId);
  });

  const result = data as { interaction: unknown; lead: unknown };
  return NextResponse.json({
    interaction: result.interaction,
    lead: result.lead,
  });
}

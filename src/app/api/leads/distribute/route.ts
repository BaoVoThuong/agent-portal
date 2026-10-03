import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { autoAssignLeads } from "@/lib/leads/auto-assign";
import { isPersonalLeadEventName } from "@/lib/leads/lead-type";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MAX_PER_RUN = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function fetchEventPool(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  eventId: string,
): Promise<{ ids: string[]; remaining: number }> {
  const { data, error, count } = await supabase
    .from("leads")
    .select("id", { count: "exact" })
    .eq("event_id", eventId)
    .is("assigned_to_email", null)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) throw new Error(error.message);
  const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
  return { ids, remaining: Math.max((count ?? ids.length) - ids.length, 0) };
}

async function managerActor() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { actor };
}

function readEventId(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

async function requireDistributableEvent(eventId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("lead_events")
    .select("name")
    .eq("id", eventId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "That Event is not available." }, { status: 400 });
  if (isPersonalLeadEventName(data.name)) {
    return NextResponse.json(
      { error: "Personal leads do not have an Event pool." },
      { status: 400 },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const authResult = await managerActor();
  if ("response" in authResult) return authResult.response;
  const eventId = readEventId(new URL(request.url).searchParams.get("event_id"));
  if (!eventId) return NextResponse.json({ error: "A valid event_id is required." }, { status: 400 });
  const eventError = await requireDistributableEvent(eventId);
  if (eventError) return eventError;
  const pool = await fetchEventPool(getSupabaseAdmin(), eventId);
  return NextResponse.json({ event_id: eventId, pending: pool.ids.length, remaining: pool.remaining });
}

export async function POST(request: Request) {
  const authResult = await managerActor();
  if ("response" in authResult) return authResult.response;
  const { actor } = authResult;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const eventId = readEventId(body?.event_id);
  if (!eventId) return NextResponse.json({ error: "A valid event_id is required." }, { status: 400 });
  const eventError = await requireDistributableEvent(eventId);
  if (eventError) return eventError;

  const supabase = getSupabaseAdmin();
  const pool = await fetchEventPool(supabase, eventId);
  if (pool.ids.length === 0) {
    return NextResponse.json({ assigned: 0, unassigned: 0, remaining: 0, event_id: eventId });
  }
  const outcome = await autoAssignLeads(pool.ids, eventId, actor.email.trim().toLowerCase(), supabase);
  if (outcome.assigned > 0) {
    const sourceId = readLeadMutationSourceId(request);
    after(async () => { await broadcastLeadsChanged(sourceId); });
  }
  return NextResponse.json({ ...outcome, remaining: pool.remaining, event_id: eventId });
}

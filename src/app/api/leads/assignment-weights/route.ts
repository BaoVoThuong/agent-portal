import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, canWorkLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { fetchAssignmentWeights, isAutoAssignEnabled } from "@/lib/leads/auto-assign";
import { pickWeighted, previewDistribution } from "@/lib/leads/round-robin";
import { isPersonalLeadEventName } from "@/lib/leads/lead-type";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_SIZE = 10;
const WEIGHT_ROW_COLUMNS = "agent_email,weight,position,is_active,current_weight";

function eventIdFrom(value: unknown): string | null {
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

async function actorForRequest() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  return { actor };
}

export async function GET(request: Request) {
  const authResult = await actorForRequest();
  if ("response" in authResult) return authResult.response;
  if (!canWorkLeads(authResult.actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const eventId = eventIdFrom(new URL(request.url).searchParams.get("event_id"));
  if (!eventId) return NextResponse.json({ error: "A valid event_id is required." }, { status: 400 });
  const eventError = await requireDistributableEvent(eventId);
  if (eventError) return eventError;
  const supabase = getSupabaseAdmin();
  const [rows, enabled] = await Promise.all([
    fetchAssignmentWeights(eventId, supabase),
    isAutoAssignEnabled(eventId, supabase),
  ]);
  const usable = rows.filter((row) => row.is_active && row.weight > 0);
  const totalWeight = usable.reduce((sum, row) => sum + row.weight, 0);
  const entries = usable.map((row) => ({
    email: row.agent_email,
    weight: row.weight,
    currentWeight: row.current_weight,
    position: row.position,
  }));
  return NextResponse.json({
    eventId,
    enabled,
    weights: rows.map((row) => ({
      agent_email: row.agent_email,
      weight: row.weight,
      position: row.position,
      is_active: row.is_active,
      current_weight: row.current_weight,
      share: totalWeight > 0 && row.is_active && row.weight > 0
        ? Math.round((row.weight / totalWeight) * 1000) / 10
        : 0,
    })),
    preview: previewDistribution(entries, PREVIEW_SIZE),
    sequence: pickWeighted(entries, PREVIEW_SIZE).picks,
  });
}

type WeightInput = { agent_email: string; weight: number; position: number; is_active: boolean };

function parseWeights(value: unknown): WeightInput[] | { error: string } {
  if (!Array.isArray(value)) return { error: "weights must be a list." };
  const parsed: WeightInput[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return { error: "Each weight must be an object." };
    const row = raw as Record<string, unknown>;
    const agentEmail = typeof row.agent_email === "string" ? row.agent_email.trim().toLowerCase() : "";
    if (!agentEmail) return { error: "Each weight needs an Agent." };
    if (seen.has(agentEmail)) return { error: `${agentEmail} is listed twice.` };
    seen.add(agentEmail);
    const weight = Number(row.weight);
    if (!Number.isInteger(weight) || weight < 0) {
      return { error: `Weight for ${agentEmail} must be a whole number of 0 or more.` };
    }
    parsed.push({
      agent_email: agentEmail,
      weight,
      position: Number.isInteger(Number(row.position)) ? Number(row.position) : 0,
      is_active: row.is_active !== false,
    });
  }
  return parsed;
}

export async function PUT(request: Request) {
  const authResult = await actorForRequest();
  if ("response" in authResult) return authResult.response;
  const { actor } = authResult;
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const eventId = eventIdFrom(body?.event_id);
  if (!eventId) return NextResponse.json({ error: "A valid event_id is required." }, { status: 400 });
  const eventError = await requireDistributableEvent(eventId);
  if (eventError) return eventError;
  const parsed = parseWeights(body?.weights);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { error } = await getSupabaseAdmin().rpc("save_lead_event_assignment_weights", {
    p_event_id: eventId,
    p_rows: parsed,
    p_enabled: typeof body?.enabled === "boolean" ? body.enabled : null,
    p_actor_email: actor.email.trim().toLowerCase(),
  });
  if (error) {
    if (error.message.includes("LEAD_ACTOR_REQUIRED")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error.message.includes("LEAD_EVENT_INVALID")) {
      return NextResponse.json({ error: "That Event is not available." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const authResult = await actorForRequest();
  if ("response" in authResult) return authResult.response;
  const { actor } = authResult;
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const eventId = eventIdFrom(body?.event_id);
  if (!eventId) return NextResponse.json({ error: "A valid event_id is required." }, { status: 400 });
  const eventError = await requireDistributableEvent(eventId);
  if (eventError) return eventError;
  const agentEmail = typeof body?.agent_email === "string" ? body.agent_email.trim().toLowerCase() : "";
  if (!agentEmail) return NextResponse.json({ error: "An Agent is required." }, { status: 400 });
  if (typeof body?.is_active !== "boolean") {
    return NextResponse.json({ error: "is_active must be true or false." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const [existingResult, countResult] = await Promise.all([
    supabase.from("lead_event_assignment_weights").select("agent_email,is_active")
      .eq("event_id", eventId).eq("agent_email", agentEmail).maybeSingle(),
    body.is_active
      ? supabase.from("lead_event_assignment_weights").select("agent_email", { count: "exact", head: true }).eq("event_id", eventId)
      : Promise.resolve({ count: null as number | null, error: null }),
  ]);
  if (existingResult.error) return NextResponse.json({ error: existingResult.error.message }, { status: 500 });

  let row: unknown = null;
  if (existingResult.data) {
    const reAdding = body.is_active && existingResult.data.is_active === false;
    const { data, error } = await supabase.from("lead_event_assignment_weights")
      .update({
        is_active: body.is_active,
        ...(reAdding ? { weight: 1, current_weight: 0 } : {}),
        updated_by_email: actor.email.trim().toLowerCase(),
        updated_at: nowIso,
      })
      .eq("event_id", eventId).eq("agent_email", agentEmail)
      .select(WEIGHT_ROW_COLUMNS).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    row = data;
  } else if (body.is_active) {
    const { data, error } = await supabase.from("lead_event_assignment_weights")
      .insert({
        event_id: eventId,
        agent_email: agentEmail,
        weight: 1,
        position: (countResult.count ?? 0) + 1,
        is_active: true,
        updated_by_email: actor.email.trim().toLowerCase(),
        updated_at: nowIso,
      })
      .select(WEIGHT_ROW_COLUMNS).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    row = data;
  }
  return NextResponse.json({ ok: true, row });
}

export async function POST(request: Request) {
  const authResult = await actorForRequest();
  if ("response" in authResult) return authResult.response;
  const { actor } = authResult;
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const eventId = eventIdFrom(body?.event_id);
  if (body?.action !== "reset_cursor" || !eventId) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  const eventError = await requireDistributableEvent(eventId);
  if (eventError) return eventError;
  const { error } = await getSupabaseAdmin().from("lead_event_assignment_weights")
    .update({ current_weight: 0, updated_at: new Date().toISOString() })
    .eq("event_id", eventId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

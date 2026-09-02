import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, canWorkLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import { validateStatusInput, validateTypeInput } from "@/lib/leads/vocabulary";
import { fetchLeadVocabulary } from "@/lib/leads/queries";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const STATUS_COLUMNS = "id,label,color,position,kind,archived_at";
const TYPE_COLUMNS = "id,label,color,position,counts_as_contact,archived_at";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not update lead vocabulary.";
  if (message.includes("23505") || message.toLowerCase().includes("duplicate key")) {
    return NextResponse.json({ error: "That label is already in use." }, { status: 400 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canWorkLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Dùng chung fetchLeadVocabulary thay vì giữ bản sao truy vấn riêng: hai bản
  // sao của cùng một câu hỏi là hai cơ hội để chúng lệch nhau.
  const vocabulary = await fetchLeadVocabulary(getSupabaseAdmin());
  return NextResponse.json({
    statuses: vocabulary.statuses,
    types: vocabulary.types,
    archivedStatuses: vocabulary.archivedStatuses,
  });
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const resource = body?.resource;
  if (resource !== "status" && resource !== "type") return NextResponse.json({ error: "Vocabulary resource is required." }, { status: 400 });
  const validation = resource === "status" ? validateStatusInput(body) : validateTypeInput(body);
  if ("error" in validation) return NextResponse.json({ error: validation.error }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const result = resource === "status"
    ? await supabase.from("lead_statuses").insert(validation).select(STATUS_COLUMNS).single()
    : await supabase.from("lead_interaction_types").insert(validation).select(TYPE_COLUMNS).single();
  if (result.error) return errorResponse(result.error.message);
  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId); });
  return NextResponse.json({ [resource]: result.data });
}

export async function PATCH(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const resource = body?.resource;
  const id = typeof body?.id === "string" ? body.id : "";
  if ((resource !== "status" && resource !== "type") || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "A valid vocabulary resource and id are required." }, { status: 400 });
  }

  const archivedAt = body?.archived_at;
  let patch: Record<string, unknown>;
  if (archivedAt !== undefined) {
    if (typeof archivedAt !== "string" || !Number.isFinite(Date.parse(archivedAt))) {
      return NextResponse.json({ error: "archived_at must be a valid ISO date." }, { status: 400 });
    }
    patch = { archived_at: archivedAt };
  } else {
    const validation = resource === "status" ? validateStatusInput(body) : validateTypeInput(body);
    if ("error" in validation) return NextResponse.json({ error: validation.error }, { status: 400 });
    patch = validation;
  }
  patch.updated_at = new Date().toISOString();

  const supabase = getSupabaseAdmin();
  const result = resource === "status"
    ? await supabase.from("lead_statuses").update(patch).eq("id", id).select(STATUS_COLUMNS).maybeSingle()
    : await supabase.from("lead_interaction_types").update(patch).eq("id", id).select(TYPE_COLUMNS).maybeSingle();
  if (result.error) return errorResponse(result.error.message);
  if (!result.data) return NextResponse.json({ error: "Vocabulary item not found." }, { status: 404 });
  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId); });
  return NextResponse.json({ [resource]: result.data });
}

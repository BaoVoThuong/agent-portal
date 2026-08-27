import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, canWorkLeads } from "@/lib/leads/access";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email);
  if (!canWorkLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await getSupabaseAdmin()
    .from("lead_events")
    .select("id,name,event_date,location,notes,created_at")
    .is("archived_at", null)
    .order("event_date", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email);
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "The event needs a name." }, { status: 400 });
  if (name.length > 200) return NextResponse.json({ error: "The event name is too long." }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from("lead_events")
    .insert({
      name,
      event_date: typeof body?.event_date === "string" && body.event_date ? body.event_date : null,
      location: typeof body?.location === "string" ? body.location.trim() || null : null,
      notes: typeof body?.notes === "string" ? body.notes.trim() || null : null,
      created_by_email: actor.email.trim().toLowerCase(),
    })
    .select("id,name,event_date,location,notes,created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId); });
  return NextResponse.json({ event: data });
}

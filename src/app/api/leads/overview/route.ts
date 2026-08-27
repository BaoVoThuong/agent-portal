import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads } from "@/lib/leads/access";
import { summarizeLeads } from "@/lib/leads/overview";
import { toLeadProduct, type LeadAlertSettings, type LeadRow, type LeadStatus } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const LEAD_COLUMNS =
  "id,display_number,product,event_id,full_name,phone,email,assigned_to_email," +
  "assigned_at,assigned_by_email,status_id,first_contacted_at,last_contacted_at," +
  "contact_attempt_count,next_follow_up_at,closed_at,created_by_email,created_at," +
  "updated_by_email,updated_at,custom_values,archived_at";

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email);
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const product = toLeadProduct(new URL(request.url).searchParams.get("product"));
  const supabase = getSupabaseAdmin();
  const [leadsResult, statusesResult, settingsResult, eventsResult] = await Promise.all([
    supabase.from("leads").select(LEAD_COLUMNS).eq("product", product).is("archived_at", null),
    supabase.from("lead_statuses").select("id,product,label,color,position,kind,archived_at").eq("product", product).is("archived_at", null),
    supabase.from("lead_alert_settings").select("product,no_contact_hours,stale_days,max_attempts").eq("product", product).maybeSingle(),
    supabase.from("lead_events").select("id,name,event_date").is("archived_at", null),
  ]);
  if (leadsResult.error) return NextResponse.json({ error: leadsResult.error.message }, { status: 500 });
  if (statusesResult.error) return NextResponse.json({ error: statusesResult.error.message }, { status: 500 });
  if (settingsResult.error) return NextResponse.json({ error: settingsResult.error.message }, { status: 500 });
  if (eventsResult.error) return NextResponse.json({ error: eventsResult.error.message }, { status: 500 });

  const statusById = new Map(
    ((statusesResult.data ?? []) as LeadStatus[]).map((status) => [status.id, status])
  );
  const settings = (settingsResult.data ?? {
    product, no_contact_hours: 24, stale_days: 3, max_attempts: 4,
  }) as LeadAlertSettings;
  return NextResponse.json({
    summary: summarizeLeads((leadsResult.data ?? []) as unknown as LeadRow[], statusById, settings),
    events: eventsResult.data ?? [],
  });
}

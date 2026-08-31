import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { summarizeLeads } from "@/lib/leads/overview";
import { toLeadProduct, type LeadAlertSettings, type LeadRow, type LeadStatus } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Only what summarizeLeads and resolveLeadAlerts actually read. The list view
// needs the whole row; this one aggregates, and pulling custom_values (arbitrary
// jsonb) for every lead in the product just to count flags is pure payload.
const SUMMARY_COLUMNS =
  "id,event_id,assigned_to_email,assigned_at,status_id,first_contacted_at," +
  "last_contacted_at,contact_attempt_count,next_follow_up_at,archived_at";

// PostgREST caps a single response, so one unbounded select silently returns a
// prefix once the table outgrows that cap — and a dashboard that quietly
// under-reports is worse than one that errors, because nobody thinks to doubt
// it. Page explicitly, and say so when the ceiling is hit.
const SUMMARY_PAGE_SIZE = 1000;
const SUMMARY_MAX_ROWS = 20_000;

type SummaryRow = Pick<
  LeadRow,
  | "id" | "event_id" | "assigned_to_email" | "assigned_at" | "status_id"
  | "first_contacted_at" | "last_contacted_at" | "contact_attempt_count"
  | "next_follow_up_at" | "archived_at"
>;

async function fetchAllLeadsForSummary(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  product: string
): Promise<{ rows: LeadRow[]; truncated: boolean; error: string | null }> {
  const rows: LeadRow[] = [];
  for (let offset = 0; offset < SUMMARY_MAX_ROWS; offset += SUMMARY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("leads")
      .select(SUMMARY_COLUMNS)
      .eq("product", product)
      .is("archived_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + SUMMARY_PAGE_SIZE - 1);
    if (error) return { rows, truncated: false, error: error.message };
    const page = (data ?? []) as unknown as SummaryRow[];
    for (const row of page) {
      // summarizeLeads takes a LeadRow; the fields it never reads are filled in
      // rather than widening its signature for one caller.
      rows.push({
        ...row,
        display_number: 0,
        product: product as LeadRow["product"],
        full_name: null, phone: null, email: null,
        assigned_by_email: null, closed_at: null,
        created_by_email: "", created_at: "",
        updated_by_email: null, updated_at: "",
        custom_values: {},
      });
    }
    if (page.length < SUMMARY_PAGE_SIZE) {
      return { rows, truncated: false, error: null };
    }
  }
  return { rows, truncated: true, error: null };
}

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const product = toLeadProduct(new URL(request.url).searchParams.get("product"));
  const supabase = getSupabaseAdmin();
  const [leadsResult, statusesResult, settingsResult, eventsResult] = await Promise.all([
    fetchAllLeadsForSummary(supabase, product),
    supabase.from("lead_statuses").select("id,label,color,position,kind,archived_at").is("archived_at", null),
    supabase.from("lead_alert_settings").select("product,no_contact_hours,stale_days,max_attempts").eq("product", product).maybeSingle(),
    supabase.from("lead_events").select("id,name,event_date").is("archived_at", null),
  ]);
  if (leadsResult.error) return NextResponse.json({ error: leadsResult.error }, { status: 500 });
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
    summary: summarizeLeads(leadsResult.rows, statusById, settings),
    events: eventsResult.data ?? [],
    // The client must be able to tell an honest total from a capped one.
    truncated: leadsResult.truncated,
  });
}

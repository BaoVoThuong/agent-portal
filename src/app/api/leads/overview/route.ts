import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, isLeadViewAdmin } from "@/lib/leads/access";
import { summarizeLeads } from "@/lib/leads/overview";
import { fetchLeadAlertSettings } from "@/lib/leads/queries";
import type { LeadRow, LeadStatus } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Only what summarizeLeads and resolveLeadAlerts actually read. The list view
// needs the whole row; this one aggregates, and pulling custom_values (arbitrary
// jsonb) for every lead just to count flags is pure payload.
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
): Promise<{ rows: LeadRow[]; truncated: boolean; error: string | null }> {
  const rows: LeadRow[] = [];
  for (let offset = 0; offset < SUMMARY_MAX_ROWS; offset += SUMMARY_PAGE_SIZE) {
    const query = supabase
      .from("leads")
      .select(SUMMARY_COLUMNS)
      .is("archived_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + SUMMARY_PAGE_SIZE - 1);
    const { data, error } = await query;
    if (error) return { rows, truncated: false, error: error.message };
    const page = (data ?? []) as unknown as SummaryRow[];
    for (const row of page) {
      // summarizeLeads takes a LeadRow; the fields it never reads are filled in
      // rather than widening its signature for one caller.
      rows.push({
        ...row,
        display_number: 0,
        full_name: null, phone: null, email: null, fub_link: null,
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

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!actor.canViewAll) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getSupabaseAdmin();
  const [leadsResult, statusesResult, settingsResult, eventsResult] = await Promise.all([
    fetchAllLeadsForSummary(supabase),
    // KHÔNG lọc archived: bảng tra này dùng để PHÂN LOẠI lead đã có, không phải
    // để dựng danh sách chọn. Lọc ở đây là đếm lead đã chốt Won vào nhóm còn mở
    // và cộng thêm cảnh báo cho nó.
    supabase.from("lead_statuses").select("id,label,color,position,kind,archived_at"),
    fetchLeadAlertSettings(supabase),
    supabase.from("lead_events").select("id,name,event_date").is("archived_at", null),
  ]);
  if (leadsResult.error) return NextResponse.json({ error: leadsResult.error }, { status: 500 });
  if (statusesResult.error) return NextResponse.json({ error: statusesResult.error.message }, { status: 500 });
  if (eventsResult.error) return NextResponse.json({ error: eventsResult.error.message }, { status: 500 });

  const statusById = new Map(
    ((statusesResult.data ?? []) as LeadStatus[]).map((status) => [status.id, status])
  );
  return NextResponse.json({
    summary: summarizeLeads(leadsResult.rows, statusById, settingsResult),
    events: eventsResult.data ?? [],
    // The client must be able to tell an honest total from a capped one.
    truncated: leadsResult.truncated,
  });
}

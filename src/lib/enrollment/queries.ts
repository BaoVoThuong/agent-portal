import { getSupabaseAdmin } from "@/lib/supabase";
import type {
  EnrollmentActivityRow,
  EnrollmentPerson,
  EnrollmentProgram,
  EnrollmentRecord,
  EnrollmentRecordWithStats,
} from "./types";

export const ENROLLMENT_RECORD_COLUMNS =
  "id,program,client_name,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,created_at,updated_by_email,updated_at,archived_at";

export async function fetchEnrollmentRecords(
  program: EnrollmentProgram
): Promise<EnrollmentRecordWithStats[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("enrollment_records")
    .select(ENROLLMENT_RECORD_COLUMNS)
    .eq("program", program)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);

  const records = (data ?? []) as EnrollmentRecord[];
  const ids = records.map((record) => record.id);
  if (ids.length === 0) return [];

  const [commentsRes, attachmentsRes] = await Promise.all([
    supabase
      .from("enrollment_comments")
      .select("record_id,body")
      .in("record_id", ids)
      .is("deleted_at", null),
    supabase
      .from("enrollment_attachments")
      .select("record_id")
      .in("record_id", ids),
  ]);
  if (commentsRes.error) throw new Error(commentsRes.error.message);
  if (attachmentsRes.error) throw new Error(attachmentsRes.error.message);

  const commentCounts = countByRecord(commentsRes.data ?? []);
  const commentText = textByRecord(commentsRes.data ?? []);
  const attachmentCounts = countByRecord(attachmentsRes.data ?? []);
  return records.map((record) => ({
    ...record,
    comment_count: commentCounts.get(record.id) ?? 0,
    comment_search_text: commentText.get(record.id) ?? "",
    attachment_count: attachmentCounts.get(record.id) ?? 0,
  }));
}

export async function fetchEnrollmentRecordById(
  id: string
): Promise<EnrollmentRecordWithStats | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("enrollment_records")
    .select(ENROLLMENT_RECORD_COLUMNS)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const [commentsRes, attachmentsRes] = await Promise.all([
    supabase
      .from("enrollment_comments")
      .select("id", { count: "exact", head: true })
      .eq("record_id", id)
      .is("deleted_at", null),
    supabase
      .from("enrollment_attachments")
      .select("id", { count: "exact", head: true })
      .eq("record_id", id),
  ]);
  if (commentsRes.error) throw new Error(commentsRes.error.message);
  if (attachmentsRes.error) throw new Error(attachmentsRes.error.message);

  return {
    ...(data as EnrollmentRecord),
    comment_count: commentsRes.count ?? 0,
    attachment_count: attachmentsRes.count ?? 0,
  };
}

export async function fetchEnrollmentPeople(): Promise<EnrollmentPerson[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email,name,agent_id")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .order("email", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as EnrollmentPerson[];
}

export async function fetchEnrollmentActivity(
  recordId: string
): Promise<EnrollmentActivityRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("enrollment_activity")
    .select("id,actor_email,type,meta,created_at")
    .eq("record_id", recordId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as EnrollmentActivityRow[];
}

function countByRecord(rows: { record_id?: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.record_id) continue;
    counts.set(row.record_id, (counts.get(row.record_id) ?? 0) + 1);
  }
  return counts;
}

function textByRecord(
  rows: { record_id?: string | null; body?: string | null }[]
): Map<string, string> {
  const text = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.record_id || !row.body) continue;
    const list = text.get(row.record_id) ?? [];
    list.push(row.body);
    text.set(row.record_id, list);
  }
  return new Map([...text.entries()].map(([id, bodies]) => [id, bodies.join(" ")]));
}

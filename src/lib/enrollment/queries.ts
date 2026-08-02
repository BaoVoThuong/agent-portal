import { getSupabaseAdmin } from "@/lib/supabase";
import type {
  EnrollmentActivityRow,
  EnrollmentPerson,
  EnrollmentProgram,
  EnrollmentRecord,
  EnrollmentRecordWithStats,
} from "./types";

export const ENROLLMENT_RECORD_COLUMNS =
  "id,program,client_name,description,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,custom_values,agent_email,caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,created_at,updated_by_email,updated_at,archived_at";
const ENROLLMENT_RECORD_COLUMNS_WITHOUT_DESCRIPTION =
  "id,program,client_name,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,custom_values,agent_email,caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,created_at,updated_by_email,updated_at,archived_at";
const ENROLLMENT_RECORD_COLUMNS_LEGACY =
  "id,program,client_name,description,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,agent_email,caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,created_at,updated_by_email,updated_at,archived_at";
const ENROLLMENT_RECORD_COLUMNS_LEGACY_WITHOUT_DESCRIPTION =
  "id,program,client_name,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,agent_email,caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,created_at,updated_by_email,updated_at,archived_at";

type SupabaseLikeError = { code?: string; message?: string } | null | undefined;
type LooseSupabaseRowsResult = {
  data: unknown[] | null;
  error: SupabaseLikeError;
};
type LooseSupabaseRowResult = {
  data: unknown | null;
  error: SupabaseLikeError;
};
type LooseSupabaseQueryBuilder = {
  select: (columns: string) => LooseSupabaseQueryBuilder;
  eq: (column: string, value: unknown) => LooseSupabaseQueryBuilder;
  is: (column: string, value: unknown) => LooseSupabaseQueryBuilder;
  order: (
    column: string,
    options: { ascending: boolean }
  ) => Promise<LooseSupabaseRowsResult>;
  maybeSingle: () => Promise<LooseSupabaseRowResult>;
};
type LooseSupabaseClient = {
  from: (table: string) => LooseSupabaseQueryBuilder;
};

export function isMissingEnrollmentDescriptionColumn(error: SupabaseLikeError) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    (message.includes("description") &&
      message.includes("enrollment_records") &&
      (message.includes("does not exist") || message.includes("schema cache")))
  );
}

export function isMissingEnrollmentCustomValuesColumn(error: SupabaseLikeError) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    (message.includes("custom_values") &&
      message.includes("enrollment_records") &&
      (message.includes("does not exist") || message.includes("schema cache")))
  );
}

export async function fetchEnrollmentRecords(
  program: EnrollmentProgram
): Promise<EnrollmentRecordWithStats[]> {
  const supabase = getSupabaseAdmin();
  const queryClient = supabase as unknown as LooseSupabaseClient;
  const { data, error } = await queryClient
    .from("enrollment_records")
    .select(ENROLLMENT_RECORD_COLUMNS)
    .eq("program", program)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  let rows: unknown[] | null = data;
  let queryError: SupabaseLikeError = error;
  if (isMissingEnrollmentDescriptionColumn(error)) {
    const fallback = await queryClient
      .from("enrollment_records")
      .select(ENROLLMENT_RECORD_COLUMNS_WITHOUT_DESCRIPTION)
      .eq("program", program)
      .is("archived_at", null)
      .order("updated_at", { ascending: false });
    rows = fallback.data;
    queryError = fallback.error;
  }
  if (isMissingEnrollmentCustomValuesColumn(queryError)) {
    const legacyColumns = isMissingEnrollmentDescriptionColumn(queryError)
      ? ENROLLMENT_RECORD_COLUMNS_LEGACY_WITHOUT_DESCRIPTION
      : ENROLLMENT_RECORD_COLUMNS_LEGACY;
    const fallback = await queryClient
      .from("enrollment_records")
      .select(legacyColumns)
      .eq("program", program)
      .is("archived_at", null)
      .order("updated_at", { ascending: false });
    rows = fallback.data;
    queryError = fallback.error;
  }
  if (queryError) throw new Error(queryError.message ?? "Could not fetch records.");

  const records = (rows ?? []).map(coerceEnrollmentRecord);
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
  const queryClient = supabase as unknown as LooseSupabaseClient;
  const { data, error } = await queryClient
    .from("enrollment_records")
    .select(ENROLLMENT_RECORD_COLUMNS)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  let row: unknown | null = data;
  let queryError: SupabaseLikeError = error;
  if (isMissingEnrollmentDescriptionColumn(error)) {
    const fallback = await queryClient
      .from("enrollment_records")
      .select(ENROLLMENT_RECORD_COLUMNS_WITHOUT_DESCRIPTION)
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle();
    row = fallback.data;
    queryError = fallback.error;
  }
  if (isMissingEnrollmentCustomValuesColumn(queryError)) {
    const legacyColumns = isMissingEnrollmentDescriptionColumn(queryError)
      ? ENROLLMENT_RECORD_COLUMNS_LEGACY_WITHOUT_DESCRIPTION
      : ENROLLMENT_RECORD_COLUMNS_LEGACY;
    const fallback = await queryClient
      .from("enrollment_records")
      .select(legacyColumns)
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle();
    row = fallback.data;
    queryError = fallback.error;
  }
  if (queryError) throw new Error(queryError.message ?? "Could not fetch record.");
  if (!row) return null;
  const record = coerceEnrollmentRecord(row);

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
    ...record,
    comment_count: commentsRes.count ?? 0,
    attachment_count: attachmentsRes.count ?? 0,
  };
}

function coerceEnrollmentRecord(row: unknown): EnrollmentRecord {
  return {
    description: null,
    custom_values: {},
    ...(row as Record<string, unknown>),
  } as EnrollmentRecord;
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

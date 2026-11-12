import { getSupabaseAdmin } from "@/lib/supabase";
import { readAllRowsById } from "@/lib/pagination/all-rows";
import { mapWithConcurrency } from "@/lib/pagination/concurrency";
import {
  applyEnrollmentScope,
  type EnrollmentScope,
} from "./scope";
import type {
  EnrollmentActivityRow,
  EnrollmentPerson,
  EnrollmentProgram,
  EnrollmentRecord,
  EnrollmentRecordWithStats,
} from "./types";
import {
  EnrollmentSchemaOutOfDateError,
  isEnrollmentSchemaOutOfDate,
  type SupabaseLikeError,
} from "./schema-errors";

/** Bộ cột trước khi có Carrier nhiều hãng; vẫn dùng khi DB chưa chạy rollout. */
const ENROLLMENT_RECORD_COLUMNS_WITHOUT_CARRIER_IDS =
  "id,display_number,program,client_name,description,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,custom_values,agent_email,caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,created_at,updated_by_email,updated_at,archived_at,stage_entered_at,stage_entered_source,last_activity_at,last_activity_by_email";
export const ENROLLMENT_RECORD_COLUMNS =
  `${ENROLLMENT_RECORD_COLUMNS_WITHOUT_CARRIER_IDS},carrier_ids`;
const ENROLLMENT_RECORD_COLUMNS_WITHOUT_DESCRIPTION =
  "id,program,client_name,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,custom_values,agent_email,caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,created_at,updated_by_email,updated_at,archived_at,stage_entered_at,stage_entered_source,last_activity_at,last_activity_by_email";
const ENROLLMENT_RECORD_COLUMNS_LEGACY =
  "id,program,client_name,description,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,agent_email,caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,created_at,updated_by_email,updated_at,archived_at,stage_entered_at,stage_entered_source,last_activity_at,last_activity_by_email";
const ENROLLMENT_RECORD_COLUMNS_LEGACY_WITHOUT_DESCRIPTION =
  "id,program,client_name,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,agent_email,caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,created_at,updated_by_email,updated_at,archived_at,stage_entered_at,stage_entered_source,last_activity_at,last_activity_by_email";

type LooseSupabaseRowsResult = {
  data: unknown[] | null;
  error: { code?: string; message: string } | null;
  count?: number | null;
  status?: number;
};
type LooseSupabaseRowResult = {
  data: unknown | null;
  error: SupabaseLikeError;
};
type LooseSupabaseQueryBuilder = {
  select: (
    columns: string,
    options?: { count?: "exact" }
  ) => LooseSupabaseQueryBuilder;
  eq: (column: string, value: unknown) => LooseSupabaseQueryBuilder;
  in: (column: string, values: readonly string[]) => LooseSupabaseQueryBuilder;
  is: (column: string, value: unknown) => LooseSupabaseQueryBuilder;
  order: (
    column: string,
    options: { ascending: boolean }
  ) => LooseSupabaseQueryBuilder;
  gt: (column: string, value: unknown) => LooseSupabaseQueryBuilder;
  limit: (count: number) => PromiseLike<LooseSupabaseRowsResult>;
  maybeSingle: () => Promise<LooseSupabaseRowResult>;
};
type LooseSupabaseClient = {
  from: (table: string) => LooseSupabaseQueryBuilder;
};

export function isMissingEnrollmentDescriptionColumn(error: SupabaseLikeError) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    (message.includes("description") &&
      message.includes("enrollment_records") &&
      (message.includes("does not exist") || message.includes("schema cache")))
  );
}

export function isMissingEnrollmentCustomValuesColumn(error: SupabaseLikeError) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    (message.includes("custom_values") &&
      message.includes("enrollment_records") &&
      (message.includes("does not exist") || message.includes("schema cache")))
  );
}

export const ENROLLMENT_TRACKING_COLUMNS =
  "stage_entered_at,stage_entered_source,last_activity_at,last_activity_by_email";
const ENROLLMENT_CHILD_RECORD_ID_CHUNK_SIZE = 50;

export function chunkEnrollmentRecordIds(
  ids: readonly string[],
  chunkSize = ENROLLMENT_CHILD_RECORD_ID_CHUNK_SIZE,
): string[][] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("chunkSize must be a positive integer.");
  }
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += chunkSize) {
    chunks.push([...ids.slice(start, start + chunkSize)]);
  }
  return chunks;
}

async function fetchEnrollmentListChildren(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  recordIds: readonly string[],
): Promise<{
  comments: Array<{ record_id?: string | null; body?: string | null }>;
  attachments: Array<{ record_id?: string | null }>;
}> {
  if (recordIds.length === 0) return { comments: [], attachments: [] };

  // PostgREST serializes `.in()` values into the request URL. A single query
  // containing hundreds/thousands of UUIDs can fail before Supabase returns a
  // structured error, so keep each request bounded while preserving parallel
  // comment/attachment hydration.
  const chunks = chunkEnrollmentRecordIds(recordIds);
  const [commentResults, attachmentResults] = await Promise.all([
    mapWithConcurrency(chunks, 4, (chunk) =>
      readAllRowsById<{ id: string; record_id: string; body: string | null }>((afterId, pageSize, withCount) => {
        let query = supabase.from("enrollment_comments")
          .select("id,record_id,body", withCount ? { count: "exact" } : undefined)
          .in("record_id", chunk).is("deleted_at", null);
        if (afterId) query = query.gt("id", afterId);
        return query.order("id").limit(pageSize);
      }),
    ),
    mapWithConcurrency(chunks, 4, (chunk) =>
      readAllRowsById<{ id: string; record_id: string }>((afterId, pageSize, withCount) => {
        let query = supabase.from("enrollment_attachments")
          .select("id,record_id", withCount ? { count: "exact" } : undefined)
          .in("record_id", chunk);
        if (afterId) query = query.gt("id", afterId);
        return query.order("id").limit(pageSize);
      }),
    ),
  ]);

  const commentError = commentResults.find((result) => result.error)?.error;
  if (commentError) throw new Error(commentError.message);
  const attachmentError = attachmentResults.find((result) => result.error)?.error;
  if (attachmentError) throw new Error(attachmentError.message);

  return {
    comments: commentResults.flatMap((result) => result.data ?? []),
    attachments: attachmentResults.flatMap((result) => result.data ?? []),
  };
}

export type EnrollmentListChildStats = {
  comment_count: number;
  attachment_count: number;
  comment_search_text: string;
};

export async function fetchEnrollmentListChildStats(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  recordIds: readonly string[],
): Promise<Map<string, EnrollmentListChildStats>> {
  if (recordIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc("enrollment_list_child_stats", {
    p_record_ids: [...recordIds],
  });
  if (!error) {
    return new Map(
      Object.entries((data ?? {}) as Record<string, EnrollmentListChildStats>),
    );
  }
  if (error.code !== "PGRST202") throw new Error(error.message);

  console.warn("Enrollment list stats RPC missing; using per-chunk reads", {
    records: recordIds.length,
  });
  const { comments, attachments } = await fetchEnrollmentListChildren(supabase, recordIds);
  const commentCounts = countByRecord(comments);
  const commentText = textByRecord(comments);
  const attachmentCounts = countByRecord(attachments);
  return new Map(
    recordIds.map((id) => [
      id,
      {
        comment_count: commentCounts.get(id) ?? 0,
        attachment_count: attachmentCounts.get(id) ?? 0,
        comment_search_text: commentText.get(id) ?? "",
      },
    ]),
  );
}

export function isMissingEnrollmentTrackingColumn(error: SupabaseLikeError): boolean {
  return isEnrollmentSchemaOutOfDate(error);
}

/**
 * Cột `carrier_ids` chưa có — code đã deploy mà rollout
 * 2026-09-29-enrollment-multi-carrier.sql chưa chạy. Đọc lại bằng bộ cột cũ để
 * cả màn Enrollment không sập vì một cột mới: thiếu mảng thì
 * enrollmentCarrierIds() rơi về `carrier_id`.
 */
function isMissingCarrierIdsColumn(error: SupabaseLikeError): boolean {
  return (
    (error?.code === "42703" || error?.code === "PGRST204") &&
    (error?.message ?? "").toLowerCase().includes("carrier_ids")
  );
}

export async function fetchEnrollmentRecords(
  program: EnrollmentProgram,
  scope: EnrollmentScope
): Promise<EnrollmentRecordWithStats[]> {
  const supabase = getSupabaseAdmin();
  const queryClient = supabase as unknown as LooseSupabaseClient;
  const readList = (columns: string) =>
    readAllRowsById<{ id: string }>((afterId, pageSize, withCount) => {
      let query = queryClient
        .from("enrollment_records")
        .select(columns, withCount ? { count: "exact" } : undefined)
        .eq("program", program)
        .is("archived_at", null);
      if (afterId) query = query.gt("id", afterId);
      return applyEnrollmentScope(query, scope)
        .order("id", { ascending: true })
        .limit(pageSize) as PromiseLike<LooseSupabaseRowsResult & { data: { id: string }[] | null }>;
    });
  let primary = await readList(ENROLLMENT_RECORD_COLUMNS);
  if (isMissingCarrierIdsColumn(primary.error)) {
    primary = await readList(ENROLLMENT_RECORD_COLUMNS_WITHOUT_CARRIER_IDS);
  }
  const { data, error, count } = primary;
  let rows: unknown[] | null = data;
  let queryError: SupabaseLikeError = error;
  let rowCount: number | null | undefined = count;
  if (isMissingEnrollmentTrackingColumn(error)) {
    throw new EnrollmentSchemaOutOfDateError();
  }
  if (isMissingEnrollmentDescriptionColumn(error)) {
    const fallback = await readList(ENROLLMENT_RECORD_COLUMNS_WITHOUT_DESCRIPTION);
    rows = fallback.data;
    queryError = fallback.error;
    rowCount = fallback.count;
  }
  if (isMissingEnrollmentCustomValuesColumn(queryError)) {
    const legacyColumns = isMissingEnrollmentDescriptionColumn(queryError)
      ? ENROLLMENT_RECORD_COLUMNS_LEGACY_WITHOUT_DESCRIPTION
      : ENROLLMENT_RECORD_COLUMNS_LEGACY;
    const fallback = await readList(legacyColumns);
    rows = fallback.data;
    queryError = fallback.error;
    rowCount = fallback.count;
  }
  if (isMissingEnrollmentTrackingColumn(queryError)) {
    throw new EnrollmentSchemaOutOfDateError();
  }
  if (queryError) throw new Error(queryError.message ?? "Could not fetch records.");
  // readAllRowsById walks every page, so a count above the rows loaded means
  // records left the list (archived, or out of this viewer's scope) while the
  // pages were being read. Every record that stayed is here, and the next
  // refresh shows the settled list. Throwing would show the 2026-11-12
  // "This page couldn't load" over a race that fixes itself, so log it.
  const loaded = rows?.length ?? 0;
  if (typeof rowCount === "number" && rowCount > loaded) {
    console.warn("[enrollment-list] list changed while paging", {
      program,
      total: rowCount,
      loaded,
    });
  }

  const records = (rows ?? []).map(coerceEnrollmentRecord);
  records.sort((a, b) =>
    String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")) ||
    a.id.localeCompare(b.id)
  );
  const ids = records.map((record) => record.id);
  if (ids.length === 0) return [];

  const stats = await fetchEnrollmentListChildStats(supabase, ids);
  return records.map((record) => ({
    ...record,
    comment_count: stats.get(record.id)?.comment_count ?? 0,
    comment_search_text: stats.get(record.id)?.comment_search_text ?? "",
    attachment_count: stats.get(record.id)?.attachment_count ?? 0,
  }));
}

export class EnrollmentListTruncatedError extends Error {
  readonly total: number;
  readonly loaded: number;

  constructor(total: number, loaded: number) {
    super(
      `Enrollment list is larger than the server response limit (${loaded} of ${total} rows loaded).`
    );
    this.name = "EnrollmentListTruncatedError";
    this.total = total;
    this.loaded = loaded;
  }
}

export function assertEnrollmentRecordsComplete(
  rows: unknown[] | null,
  count: number | null | undefined
): void {
  const loaded = rows?.length ?? 0;
  if (typeof count === "number" && count > loaded) {
    throw new EnrollmentListTruncatedError(count, loaded);
  }
}

export async function fetchEnrollmentRecordById(
  id: string
): Promise<EnrollmentRecordWithStats | null> {
  const supabase = getSupabaseAdmin();
  const queryClient = supabase as unknown as LooseSupabaseClient;
  const readPrimary = (columns: string) =>
    queryClient
      .from("enrollment_records")
      .select(columns)
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle();
  let primary = await readPrimary(ENROLLMENT_RECORD_COLUMNS);
  if (isMissingCarrierIdsColumn(primary.error)) {
    primary = await readPrimary(ENROLLMENT_RECORD_COLUMNS_WITHOUT_CARRIER_IDS);
  }
  const { data, error } = primary;
  let row: unknown | null = data;
  let queryError: SupabaseLikeError = error;
  if (isMissingEnrollmentTrackingColumn(error)) {
    throw new EnrollmentSchemaOutOfDateError();
  }
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
  if (isMissingEnrollmentTrackingColumn(queryError)) {
    throw new EnrollmentSchemaOutOfDateError();
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
  const { data, error } = await readAllRowsById<EnrollmentActivityRow>(
    (afterId, pageSize, withCount) => {
      let query = getSupabaseAdmin().from("enrollment_activity")
        .select("id,actor_email,type,meta,created_at", withCount ? { count: "exact" } : undefined)
        .eq("record_id", recordId);
      if (afterId) query = query.gt("id", afterId);
      return query.order("id").limit(pageSize);
    },
  );
  if (error) throw new Error(error.message);
  return (data ?? []).sort((a, b) =>
    b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
  );
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

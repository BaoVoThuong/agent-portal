import { getSupabaseAdmin } from "@/lib/supabase";
import { readTaskFileInfo } from "./storage";

export type UploadIntentKind = "task" | "enrollment" | "lead";

export class UploadIntentConflictError extends Error {}

export type UploadIntent = {
  kind: UploadIntentKind;
  record_id: string;
  uploaded_by: string;
  client_request_id: string;
  comment_id: string | null;
  file_name: string;
  size_bytes: number;
  storage_path: string;
  silent: boolean;
  created_at?: string;
  completed_at?: string | null;
  failed_at?: string | null;
  failure_reason?: string | null;
};

const IDENTITY_COLUMNS =
  "kind,record_id,uploaded_by,client_request_id,comment_id,file_name,size_bytes,storage_path,silent,created_at,completed_at,failed_at,failure_reason";

/** A request id may be replayed, but never for a different file or comment. */
export function sameUploadIntent(a: UploadIntent, b: UploadIntent): boolean {
  return a.kind === b.kind && a.record_id === b.record_id &&
    a.uploaded_by === b.uploaded_by && a.client_request_id === b.client_request_id &&
    a.comment_id === b.comment_id && a.file_name === b.file_name &&
    a.size_bytes === b.size_bytes && a.storage_path === b.storage_path &&
    a.silent === b.silent;
}

/** A replay may return a saved row only when it belongs to this exact upload. */
export function savedAttachmentMatchesIntent(
  row: { storage_path: string; file_name: string; size_bytes: number | string | null },
  intent: UploadIntent,
): boolean {
  return row.storage_path === intent.storage_path && row.file_name === intent.file_name &&
    Number(row.size_bytes) === intent.size_bytes;
}

function lookup(intent: UploadIntent) {
  return getSupabaseAdmin()
    .from("attachment_upload_intents")
    .select(IDENTITY_COLUMNS)
    .eq("kind", intent.kind)
    .eq("record_id", intent.record_id)
    .eq("uploaded_by", intent.uploaded_by)
    .eq("client_request_id", intent.client_request_id)
    .maybeSingle();
}

/** Persist before returning a signed token. A committed object now has a
 * server-owned path back to its comment, even if the browser disappears. */
export async function reserveUploadIntent(intent: UploadIntent): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("attachment_upload_intents")
    .insert(intent);
  if (error && error.code !== "23505") throw new Error(error.message);
  if (error) {
    const existing = await requireUploadIntent(intent);
    // A metadata row may have since been deleted. Never let an old request ID
    // upload the same object again and silently resurrect that attachment.
    if (existing.completed_at) {
      throw new UploadIntentConflictError("This upload was already completed. Choose the file again.");
    }
    const { error: resetError } = await getSupabaseAdmin()
      .from("attachment_upload_intents")
      .update({ failed_at: null, failure_reason: null, next_check_at: new Date().toISOString() })
      .eq("kind", intent.kind)
      .eq("record_id", intent.record_id)
      .eq("uploaded_by", intent.uploaded_by)
      .eq("client_request_id", intent.client_request_id)
      .is("completed_at", null)
      .not("failed_at", "is", null);
    if (resetError) throw new Error(resetError.message);
  }
}

export async function requireUploadIntent(intent: UploadIntent): Promise<UploadIntent> {
  const { data, error } = await lookup(intent);
  if (error) throw new Error(error.message);
  if (!data || !sameUploadIntent(data as UploadIntent, intent)) {
    throw new UploadIntentConflictError("This upload request belongs to another file or comment.");
  }
  return data as UploadIntent;
}

export async function completeUploadIntent(intent: UploadIntent): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("attachment_upload_intents")
    .update({ completed_at: new Date().toISOString(), failed_at: null, failure_reason: null })
    .eq("kind", intent.kind)
    .eq("record_id", intent.record_id)
    .eq("uploaded_by", intent.uploaded_by)
    .eq("client_request_id", intent.client_request_id)
    .is("completed_at", null);
  if (error) throw new Error(error.message);
}

export async function failUploadIntent(intent: UploadIntent, reason: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("attachment_upload_intents")
    .update({ failed_at: new Date().toISOString(), failure_reason: reason.slice(0, 500) })
    .eq("kind", intent.kind)
    .eq("record_id", intent.record_id)
    .eq("uploaded_by", intent.uploaded_by)
    .eq("client_request_id", intent.client_request_id)
    .is("completed_at", null)
    .is("failed_at", null);
  if (error) throw new Error(error.message);
}

export async function pendingCommentUploads(
  kind: "task" | "enrollment",
  recordId: string,
): Promise<Map<string, { file_name: string; size_bytes: number; failure_reason: string | null }[]>> {
  const { data, error } = await getSupabaseAdmin()
    .from("attachment_upload_intents")
    .select("comment_id,file_name,size_bytes,failure_reason")
    .eq("kind", kind)
    .eq("record_id", recordId)
    .is("completed_at", null)
    .not("comment_id", "is", null)
    .limit(50);
  if (error) throw new Error(error.message);
  const byComment = new Map<string, { file_name: string; size_bytes: number; failure_reason: string | null }[]>();
  for (const row of data ?? []) {
    if (!row.comment_id) continue;
    const items = byComment.get(row.comment_id) ?? [];
    items.push({ file_name: row.file_name, size_bytes: row.size_bytes, failure_reason: row.failure_reason });
    byComment.set(row.comment_id, items);
  }
  return byComment;
}

/** Detail reads repair uploads whose Storage commit outlived the tab or its JS.
 * The authorization check belongs to the calling route, before this helper. */
export async function recoverUploadIntents(
  kind: UploadIntentKind,
  recordId: string,
  finalize: (intent: UploadIntent) => Promise<boolean>,
): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from("attachment_upload_intents")
    .select(IDENTITY_COLUMNS)
    .eq("kind", kind)
    .eq("record_id", recordId)
    .is("completed_at", null)
    .is("failed_at", null)
    .lte("next_check_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw new Error(error.message);
  let recovered = 0;
  // Serializing keeps a detail request from launching many expensive Storage
  // reads and metadata transactions at once; the next refresh handles more.
  for (const intent of (data ?? []) as UploadIntent[]) {
    try {
      if (!(await readTaskFileInfo(intent.storage_path))) {
        await deferUploadIntent(intent);
        continue;
      }
      if (await finalize(intent)) recovered++;
      else await deferUploadIntent(intent);
    } catch (reason) {
      await deferUploadIntent(intent).catch(() => undefined);
      console.warn("[attachment recovery] failed", {
        kind, recordId, requestId: intent.client_request_id,
        reason: reason instanceof Error ? reason.message : "unknown",
      });
    }
  }
  return recovered;
}

async function deferUploadIntent(intent: UploadIntent): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("attachment_upload_intents")
    .update({ next_check_at: new Date(Date.now() + 15_000).toISOString() })
    .eq("kind", intent.kind)
    .eq("record_id", intent.record_id)
    .eq("uploaded_by", intent.uploaded_by)
    .eq("client_request_id", intent.client_request_id)
    .is("completed_at", null)
    .is("failed_at", null);
  if (error) throw new Error(error.message);
}

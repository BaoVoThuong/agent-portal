import { getSupabaseAdmin } from "@/lib/supabase";
import {
  ATTACHMENT_ALLOWED_MIME_TYPES,
  TASK_ATTACHMENT_MAX_BYTES,
} from "./attachments";

export const TASK_BUCKET = "task-attachments";

export function sanitizeFileName(name: string): string {
  const cleaned = name.trim().replace(/[^\w.\-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "file";
}

/**
 * `objectId` is the upload's client_request_id on the direct-to-Storage path,
 * so the route can rebuild the exact path at finalize instead of trusting one
 * sent by the browser, and a retried upload lands on the same object.
 */
export function buildStoragePath(
  taskId: string,
  fileName: string,
  objectId: string = globalThis.crypto.randomUUID(),
): string {
  return `tasks/${taskId}/${objectId}-${sanitizeFileName(fileName)}`;
}

function isAlreadyExistsError(error: { message?: string; statusCode?: string }) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.statusCode === "409" ||
    message.includes("already exists") ||
    message.includes("duplicate")
  );
}

async function verifyTaskBucket(): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.getBucket(TASK_BUCKET);
  if (error || !data) throw new Error(error?.message ?? "Attachment bucket is missing.");
  // Never mutate a shared bucket from a request. During a staged rollout old
  // and new functions can coexist; the old 4 MiB function would otherwise
  // repeatedly downgrade a 50 MiB bucket while an upload is in flight.
  if ((data.file_size_limit ?? 0) < TASK_ATTACHMENT_MAX_BYTES ||
      !ATTACHMENT_ALLOWED_MIME_TYPES.every((type) => data.allowed_mime_types?.includes(type))) {
    throw new Error("Attachment storage is not configured for 50MB uploads.");
  }
}

async function ensureTaskBucket(): Promise<void> {
  // A different deployment can still change this shared bucket after an
  // earlier request verified it. Check at each prepare so the client gets a
  // configuration error before sending 50 MiB to Storage.
  await verifyTaskBucket();
}

export async function uploadTaskFile(
  path: string,
  data: ArrayBuffer,
  contentType: string
): Promise<void> {
  await ensureTaskBucket();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage
    .from(TASK_BUCKET)
    .upload(path, data, { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

export type TaskUploadTicket =
  | { bucket: string; path: string; token: string; alreadyUploaded: false }
  | { bucket: string; path: string; token: null; alreadyUploaded: true };

/**
 * A one-time token the browser uses to PUT this exact object straight to
 * Storage, so the bytes never pass through a Vercel Function (4.5MB body cap).
 * Valid for 2 hours and never overwrites; the bucket's size and type limits
 * still apply to the PUT.
 *
 * Storage refuses to sign a path that already holds an object ("The resource
 * already exists", seen on production 2026-10-21). That is a retry whose
 * upload landed but whose finalize did not, so report it instead of failing:
 * the browser skips straight to finalize.
 */
export async function createTaskUploadTicket(path: string): Promise<TaskUploadTicket> {
  await ensureTaskBucket();
  const { data, error } = await getSupabaseAdmin()
    .storage.from(TASK_BUCKET)
    .createSignedUploadUrl(path);
  if (error && isAlreadyExistsError(error as { message?: string; statusCode?: string })) {
    return { bucket: TASK_BUCKET, path, token: null, alreadyUploaded: true };
  }
  if (error || !data) throw new Error(error?.message ?? "Could not prepare the upload.");
  return { bucket: TASK_BUCKET, path: data.path, token: data.token, alreadyUploaded: false };
}

export type TaskFileInfo = { size: number; contentType: string | null };

function isNotFoundError(error: { message?: string; status?: number; statusCode?: string }) {
  return (
    error.status === 404 ||
    error.statusCode === "404" ||
    (error.message?.toLowerCase().includes("not found") ?? false)
  );
}

/** Size and content type Storage recorded for an object; null when it does not exist. */
export async function readTaskFileInfo(path: string): Promise<TaskFileInfo | null> {
  const { data, error } = await getSupabaseAdmin().storage.from(TASK_BUCKET).info(path);
  if (error) {
    if (isNotFoundError(error as { message?: string; status?: number; statusCode?: string })) {
      return null;
    }
    throw new Error(error.message);
  }
  return { size: data.size ?? 0, contentType: data.contentType ?? null };
}

/**
 * The first `byteCount` bytes of an object: enough for the file-signature
 * checks. Stops reading after them even if Storage ignores the Range header,
 * so a 50MB upload is never pulled into the function.
 */
export async function readTaskFileHead(path: string, byteCount = 512): Promise<ArrayBuffer> {
  const url = await signTaskFile(path, 60);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${byteCount - 1}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Could not read the uploaded file (${response.status}).`);
    }
    const reader = response.body.getReader();
    const head = new Uint8Array(byteCount);
    let length = 0;
    try {
      while (length < byteCount) {
        const { done, value } = await reader.read();
        if (done) break;
        const part = value.subarray(0, byteCount - length);
        head.set(part, length);
        length += part.length;
      }
    } finally {
      // Abort the underlying fetch when Storage ignores Range. Never await
      // reader.cancel(): Next.js tees fetch bodies and one branch can hang.
      controller.abort();
      void reader.cancel().catch(() => undefined);
    }
    return head.slice(0, length).buffer;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export async function signTaskFile(path: string, expiresIn = 3600): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(TASK_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data) throw new Error(error?.message ?? "Could not sign file");
  return data.signedUrl;
}

export type BatchSignedTaskFile = {
  error: string | null;
  path: string | null;
  signedUrl: string | null;
};

/** Sign many private task objects with one Storage API round-trip. */
export async function signTaskFiles(
  paths: string[],
  expiresIn = 3600,
): Promise<BatchSignedTaskFile[]> {
  if (paths.length === 0) return [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(TASK_BUCKET)
    .createSignedUrls(paths, expiresIn);
  if (error || !data) throw new Error(error?.message ?? "Could not sign files");
  return data;
}

export async function removeTaskFile(path: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(TASK_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

export async function removeTaskFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(TASK_BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}

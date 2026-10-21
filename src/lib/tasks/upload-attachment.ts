import { getBrowserSupabase } from "@/lib/supabase-browser";
import { attachmentTooLargeMessage } from "./attachments";

export type UploadAttachmentFields = {
  commentId?: string | null;
  /** Stable per file so a retry reuses the same object and row. */
  clientRequestId?: string | null;
  /** Task-level upload without the usual "attachment added" notification. */
  silent?: boolean;
};

type StorageUploadError = { message?: string; status?: number; statusCode?: string };

type PendingUpload = {
  endpoint: string;
  fileName: string;
  size: number;
  commentId: string | null;
  clientRequestId: string;
  silent: boolean;
  createdAt: number;
};

const PENDING_KEY = "eps.pending-attachment-finalizations.v1";
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PREPARE_TIMEOUT_MS = 30_000;
const FINALIZE_TIMEOUT_MS = 20_000;
const UPLOAD_CONFIRMATION_TIMEOUT_MS = 15 * 60 * 1000;
const LATE_STORAGE_COMMIT_GRACE_MS = 30_000;

function pendingUploads(): PendingUpload[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PendingUpload =>
      item && typeof item.endpoint === "string" && typeof item.fileName === "string" &&
      typeof item.size === "number" && typeof item.clientRequestId === "string" &&
      typeof item.createdAt === "number" && Date.now() - item.createdAt < PENDING_MAX_AGE_MS,
    );
  } catch {
    return [];
  }
}

function savePending(items: PendingUpload[]): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
    // Storage may be disabled. The current upload still works normally.
  }
}

function rememberPending(item: PendingUpload): void {
  savePending([...pendingUploads().filter((row) => row.clientRequestId !== item.clientRequestId), item]);
}

function forgetPending(clientRequestId: string): void {
  savePending(pendingUploads().filter((row) => row.clientRequestId !== clientRequestId));
}

/** Finish a PUT that landed before its tab was reloaded or lost the response. */
export async function recoverPendingAttachments(endpoint: string): Promise<number> {
  let recovered = 0;
  for (const item of pendingUploads().filter((row) => row.endpoint === endpoint)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FINALIZE_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "finalize",
          file_name: item.fileName,
          size: item.size,
          comment_id: item.commentId,
          client_request_id: item.clientRequestId,
          silent: item.silent,
        }),
      });
      if (response.ok) {
        forgetPending(item.clientRequestId);
        recovered++;
      }
    } catch {
      // A later visit can retry the same id without duplicating metadata.
    } finally {
      clearTimeout(timeout);
    }
  }
  return recovered;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The object is already there: an earlier attempt uploaded it, then finalize did not finish. */
function isAlreadyUploaded(error: StorageUploadError): boolean {
  return (
    error.statusCode === "409" ||
    (error.message?.toLowerCase().includes("already exists") ?? false)
  );
}

function storageErrorMessage(error: StorageUploadError): string {
  if (error.status === 413 || error.statusCode === "413") return attachmentTooLargeMessage();
  return error.message || "Could not upload attachment.";
}

function isDefiniteSizeRefusal(error: StorageUploadError): boolean {
  return error.status === 413 || error.statusCode === "413";
}

async function finalizeWithRetry(post: () => Promise<Response>): Promise<Response> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await post();
      if (response.status < 500) return response;
    } catch {
      // The metadata transaction may have committed before the connection
      // failed. The stable request id makes another finalize safe.
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return response ?? jsonResponse({ error: "Could not confirm the attachment. Please retry." }, 502);
}

function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function uploadNotFinished(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  const body = (await response.clone().json().catch(() => null)) as { error?: string } | null;
  return body?.error === "The upload did not finish. Please try again.";
}

/** Storage can commit a PUT while its browser promise remains pending forever. */
async function confirmWhileUploading(
  post: () => Promise<Response>,
  signal: AbortSignal,
): Promise<Response> {
  const deadline = Date.now() + UPLOAD_CONFIRMATION_TIMEOUT_MS;
  let delay = 2_000;
  while (!signal.aborted && Date.now() < deadline) {
    await waitForPoll(delay, signal);
    if (signal.aborted) break;
    try {
      const response = await post();
      if (response.ok) return response;
      if (response.status < 500 && !(await uploadNotFinished(response))) return response;
    } catch {
      // Retry until the object lands or the bounded confirmation window ends.
    }
    delay = delay === 2_000 ? 5_000 : 10_000;
  }
  return jsonResponse({ error: "Upload confirmation timed out. Please retry the attachment." }, 504);
}

/**
 * Uploads one attachment straight to Supabase Storage (see
 * lib/tasks/direct-upload.ts): ask the route for a one-time upload token,
 * PUT the file to Storage, then have the route verify and record it.
 *
 * Resolves to the route's final Response (or a synthesized JSON error one),
 * so callers keep their existing `response.ok` / `{ error }` handling.
 */
export async function uploadAttachment(
  endpoint: string,
  file: File,
  fields: UploadAttachmentFields = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  const clientRequestId = fields.clientRequestId || globalThis.crypto.randomUUID();
  const post = async (action: "prepare" | "finalize") => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      action === "finalize" ? FINALIZE_TIMEOUT_MS : PREPARE_TIMEOUT_MS,
    );
    try {
      return await fetch(endpoint, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action,
          file_name: file.name,
          size: file.size,
          comment_id: fields.commentId ?? null,
          client_request_id: clientRequestId,
          silent: fields.silent ?? false,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  const prepared = await post("prepare");
  if (!prepared.ok) return prepared;
  const ticket = (await prepared.json().catch(() => null)) as {
    attachment?: unknown;
    upload?: {
      bucket?: string;
      path?: string;
      token?: string | null;
      already_uploaded?: boolean;
      content_type?: string;
    };
  } | null;
  // Already recorded under this request id (a retry after success): done.
  if (ticket?.attachment) {
    forgetPending(clientRequestId);
    return jsonResponse(ticket, 200);
  }
  const upload = ticket?.upload;
  if (!upload?.bucket || !upload.path || !upload.content_type) {
    return jsonResponse({ error: "Could not prepare the upload." }, 500);
  }
  rememberPending({
    endpoint,
    fileName: file.name,
    size: file.size,
    commentId: fields.commentId ?? null,
    clientRequestId,
    silent: fields.silent ?? false,
    createdAt: Date.now(),
  });
  // An earlier attempt's upload landed but its finalize did not.
  if (upload.already_uploaded) {
    const finalized = await finalizeWithRetry(() => post("finalize"));
    if (finalized.ok) forgetPending(clientRequestId);
    return finalized;
  }
  if (!upload.token) return jsonResponse({ error: "Could not prepare the upload." }, 500);
  const uploadBucket = upload.bucket;
  const uploadPath = upload.path;
  const uploadToken = upload.token;
  const uploadContentType = upload.content_type;

  const supabase = getBrowserSupabase();
  if (!supabase) return jsonResponse({ error: "File uploads are not configured." }, 500);
  const confirmation = new AbortController();
  const uploadAndFinalize = async (): Promise<Response> => {
    let storageError: StorageUploadError | null = null;
    try {
      // Raw bytes with an explicit type rather than the File itself: a File goes
      // up as multipart with the browser's guessed type, which is empty for
      // some extensions (e.g. .heic on Windows) and the bucket would reject it.
      const { error } = await supabase.storage
        .from(uploadBucket)
        .uploadToSignedUrl(uploadPath, uploadToken, await file.arrayBuffer(), {
          contentType: uploadContentType,
        });
      if (error && !isAlreadyUploaded(error as StorageUploadError)) {
        storageError = error as StorageUploadError;
      }
    } catch (error) {
      storageError = {
        message: error instanceof Error
          ? error.message
          : "Could not upload attachment. Check your connection and try again.",
      };
    }

    // Storage can commit the PUT and still make the browser reject its response.
    if (storageError && isDefiniteSizeRefusal(storageError)) {
      forgetPending(clientRequestId);
      return jsonResponse({ error: storageErrorMessage(storageError) }, 502);
    }
    const finalized = await finalizeWithRetry(() => post("finalize"));
    if (finalized.ok) return finalized;
    // A PUT can report a network error before Storage commits the object.
    // Keep the parallel confirmation probe alive before treating a missing
    // object as a failed upload and discarding an attachment-only comment.
    if (await uploadNotFinished(finalized)) {
      await waitForPoll(LATE_STORAGE_COMMIT_GRACE_MS, confirmation.signal);
      return storageError
        ? jsonResponse({ error: storageErrorMessage(storageError) }, 502)
        : finalized;
    }
    return finalized;
  };

  try {
    const response = await Promise.race([
      uploadAndFinalize(),
      confirmWhileUploading(() => post("finalize"), confirmation.signal),
    ]);
    if (response.ok || response.status === 413) forgetPending(clientRequestId);
    return response;
  } finally {
    confirmation.abort();
  }
}

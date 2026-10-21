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
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  const post = (action: "prepare" | "finalize") =>
    fetch(endpoint, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        file_name: file.name,
        size: file.size,
        comment_id: fields.commentId ?? null,
        client_request_id: clientRequestId,
        silent: fields.silent ?? false,
      }),
    });

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

  const supabase = getBrowserSupabase();
  if (!supabase) return jsonResponse({ error: "File uploads are not configured." }, 500);
  let storageError: StorageUploadError | null = null;
  try {
    // Raw bytes with an explicit type rather than the File itself: a File goes
    // up as multipart with the browser's guessed type, which is empty for
    // some extensions (e.g. .heic on Windows) and the bucket would reject it.
    const { error } = await supabase.storage
      .from(upload.bucket)
      .uploadToSignedUrl(upload.path, upload.token, await file.arrayBuffer(), {
        contentType: upload.content_type,
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

  // Storage can commit the PUT and still make the browser reject its response
  // (for example, a connection drop). Confirm the object with our server even
  // in that case, so a successful upload cannot remain invisible after reload.
  if (storageError && isDefiniteSizeRefusal(storageError)) {
    forgetPending(clientRequestId);
    return jsonResponse({ error: storageErrorMessage(storageError) }, 502);
  }
  const finalized = await finalizeWithRetry(() => post("finalize"));
  if (finalized.ok) forgetPending(clientRequestId);
  if (finalized.ok || !storageError) return finalized;
  const serverError = (await finalized.clone().json().catch(() => null)) as { error?: string } | null;
  // If the object never landed, the Storage error is the actionable one.
  if (serverError?.error === "The upload did not finish. Please try again.") {
    return jsonResponse({ error: storageErrorMessage(storageError) }, 502);
  }
  return finalized;
}

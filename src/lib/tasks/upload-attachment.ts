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
  if (ticket?.attachment) return jsonResponse(ticket, 200);
  const upload = ticket?.upload;
  if (!upload?.bucket || !upload.path || !upload.content_type) {
    return jsonResponse({ error: "Could not prepare the upload." }, 500);
  }
  // An earlier attempt's upload landed but its finalize did not.
  if (upload.already_uploaded) return post("finalize");
  if (!upload.token) return jsonResponse({ error: "Could not prepare the upload." }, 500);

  const supabase = getBrowserSupabase();
  if (!supabase) return jsonResponse({ error: "File uploads are not configured." }, 500);
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
      return jsonResponse({ error: storageErrorMessage(error as StorageUploadError) }, 502);
    }
  } catch {
    return jsonResponse({ error: "Could not upload attachment. Check your connection and try again." }, 502);
  }

  return post("finalize");
}

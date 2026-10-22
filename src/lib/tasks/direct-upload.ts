import {
  attachmentContentType,
  attachmentTooLargeMessage,
  TASK_ATTACHMENT_MAX_BYTES,
  validateAttachmentFile,
} from "./attachments";
import {
  readTaskFileHead,
  readTaskFileInfo,
  removeTaskFile,
  type TaskUploadTicket,
} from "./storage";

/**
 * Direct-to-Storage attachment upload (2026-10-21), shared by the task,
 * enrollment and lead attachment routes.
 *
 * A Vercel Function rejects any request body over 4.5MB before our code runs,
 * so files cannot go through the route. The route instead answers two JSON
 * calls on the same POST endpoint:
 *
 *   1. `prepare`  — same permission checks as before, then a one-time Storage
 *                   upload token for a path the ROUTE builds.
 *   2. (browser PUTs the file to Supabase Storage with that token)
 *   3. `finalize` — same permission checks again, then the uploaded object is
 *                   verified (size, recorded type, file signature) before the
 *                   attachment row is written.
 *
 * The path is `<prefix>/<client_request_id>-<sanitized name>`, rebuilt by the
 * route at finalize, so the browser can never point the route at an object of
 * its choosing, and a retry reuses the same object and the same unique
 * request key instead of creating a duplicate.
 *
 * Multipart uploads (the old path) keep working for tabs opened before this
 * deploy; they are still capped by Vercel at 4.5MB.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILE_NAME_LENGTH = 255;

export type DirectUploadAction = "prepare" | "finalize";

export type DirectUploadRequest = {
  action: DirectUploadAction;
  fileName: string;
  /** Declared by the browser; finalize trusts only the size Storage reports. */
  size: number;
  commentId: string | null;
  clientRequestId: string;
  silent: boolean;
};

export function isDirectUploadRequest(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

export function parseDirectUploadRequest(
  body: unknown,
): { ok: true; upload: DirectUploadRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid upload request." };
  const raw = body as Record<string, unknown>;

  const action = raw.action;
  if (action !== "prepare" && action !== "finalize") {
    return { ok: false, error: "Invalid upload request." };
  }
  const fileName = typeof raw.file_name === "string" ? raw.file_name : "";
  if (!fileName.trim() || fileName.length > MAX_FILE_NAME_LENGTH) {
    return { ok: false, error: "Choose a valid file." };
  }
  if (!attachmentContentType(fileName)) {
    return { ok: false, error: "Unsupported file type." };
  }
  const size = raw.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    return { ok: false, error: "Empty files cannot be uploaded." };
  }
  if (size > TASK_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: attachmentTooLargeMessage() };
  }
  const clientRequestId =
    typeof raw.client_request_id === "string" ? raw.client_request_id.trim().toLowerCase() : "";
  if (!UUID_RE.test(clientRequestId)) {
    return { ok: false, error: "Invalid request id." };
  }
  const commentId =
    typeof raw.comment_id === "string" && raw.comment_id.trim() !== ""
      ? raw.comment_id.trim()
      : null;

  return {
    ok: true,
    upload: {
      action,
      fileName,
      size,
      commentId,
      clientRequestId,
      silent: raw.silent === true || raw.silent === "1",
    },
  };
}

export async function readDirectUploadRequest(request: Request) {
  return parseDirectUploadRequest(await request.json().catch(() => null));
}

/** The `prepare` response body: where and how the browser PUTs the file. */
export function directUploadTicketBody(ticket: TaskUploadTicket, fileName: string) {
  return {
    upload: {
      bucket: ticket.bucket,
      path: ticket.path,
      token: ticket.token,
      already_uploaded: ticket.alreadyUploaded,
      content_type: attachmentContentType(fileName),
    },
  };
}

export type VerifiedUpload =
  | { ok: true; contentType: string; size: number }
  | { ok: false; status: 400 | 500; error: string };

function baseContentType(value: string): string {
  return value.split(";")[0].trim().toLowerCase();
}

/**
 * Checks the object the browser uploaded before any row points at it. A file
 * that fails is removed so it cannot linger unreferenced; a Storage outage
 * leaves it in place so the user's retry can finalize it without re-uploading.
 */
export async function verifyDirectUpload(
  path: string,
  fileName: string,
  expectedSize?: number,
): Promise<VerifiedUpload> {
  const expectedType = attachmentContentType(fileName);
  if (!expectedType) return { ok: false, status: 400, error: "Unsupported file type." };

  let info: Awaited<ReturnType<typeof readTaskFileInfo>>;
  try {
    info = await readTaskFileInfo(path);
  } catch {
    return { ok: false, status: 500, error: "Could not check the uploaded file. Please try again." };
  }
  if (!info) {
    return { ok: false, status: 400, error: "The upload did not finish. Please try again." };
  }

  const reject = async (error: string): Promise<VerifiedUpload> => {
    await removeTaskFile(path).catch((cleanupError) =>
      console.warn("[attachment] failed to remove a rejected direct upload", cleanupError),
    );
    return { ok: false, status: 400, error };
  };

  if (info.size <= 0) return reject("Empty files cannot be uploaded.");
  if (info.size > TASK_ATTACHMENT_MAX_BYTES) return reject(attachmentTooLargeMessage());
  if (expectedSize !== undefined && info.size !== expectedSize) {
    return reject("Uploaded file size does not match the selected file.");
  }
  if (info.contentType && baseContentType(info.contentType) !== expectedType) {
    return reject("File contents do not match the file type.");
  }

  let head: ArrayBuffer;
  try {
    head = await readTaskFileHead(path);
  } catch {
    return { ok: false, status: 500, error: "Could not check the uploaded file. Please try again." };
  }
  const validation = validateAttachmentFile(fileName, head);
  if (!validation.ok) return reject(validation.error);

  return { ok: true, contentType: validation.contentType, size: info.size };
}

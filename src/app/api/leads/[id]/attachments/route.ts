import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor } from "@/lib/leads/access";
import { resolveLeadCapabilities } from "@/lib/leads/capabilities";
import { isAssistantToLeadMember } from "@/lib/leads/membership";
import {
  attachmentTooLargeMessage,
  TASK_ATTACHMENT_MAX_BYTES,
  validateAttachmentFile,
} from "@/lib/tasks/attachments";
import {
  createTaskUploadTicket,
  removeTaskFile,
  sanitizeFileName,
  signTaskFile,
  uploadTaskFile,
} from "@/lib/tasks/storage";
import {
  directUploadTicketBody,
  isDirectUploadRequest,
  readDirectUploadRequest,
  verifyDirectUpload,
  type DirectUploadRequest,
} from "@/lib/tasks/direct-upload";
import { getSupabaseAdmin } from "@/lib/supabase";
import { RouteTiming } from "@/lib/server-timing";
import {
  completeUploadIntent,
  failUploadIntent,
  requireUploadIntent,
  reserveUploadIntent,
  type UploadIntent,
} from "@/lib/tasks/upload-intents";
import { recoverSavedAttachments } from "@/lib/tasks/upload-recovery";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
type AttachmentRow = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  storage_path: string;
  created_at: string;
};
// Thiếu nhóm `{3}-` trước 12 ký tự cuối (từ 6575485, 2026-09-30) khiến MỌI id
// lead bị coi là sai: drawer báo "Invalid lead id." và không đính kèm được file.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS = "id,file_name,mime_type,size_bytes,storage_path,created_at";

/** `objectId`: see buildStoragePath in lib/tasks/storage.ts. */
function leadStoragePath(
  leadId: string,
  fileName: string,
  objectId: string = crypto.randomUUID(),
): string {
  return `leads/${leadId}/${objectId}-${sanitizeFileName(fileName)}`;
}

function measure<T>(
  timing: RouteTiming | undefined,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  return timing ? timing.measure(name, operation) : operation();
}

async function loadContext(id: string, timing?: RouteTiming) {
  const session = await measure(timing, "auth", async () => auth());
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized", status: 401 } as const;
  if (!UUID_RE.test(id)) return { error: "Invalid lead id.", status: 400 } as const;

  const actor = buildLeadActor(session.user.permissions, email);
  const supabase = getSupabaseAdmin();
  const { data: lead, error } = await measure(timing, "lead_scope", async () =>
    supabase
      .from("leads")
      .select("id,assigned_to_email,collaborator_emails")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle(),
  );
  if (error) return { error: error.message, status: 500 } as const;
  if (!lead) return { error: "Not found", status: 404 } as const;
  const isOwnerOrAssistant = actor.isManager
    ? false
    : await measure(timing, "membership", async () =>
        isAssistantToLeadMember(
          lead.assigned_to_email,
          lead.collaborator_emails,
          email,
        ),
      );
  const capabilities = resolveLeadCapabilities(actor, lead, { isOwnerOrAssistant });
  if (!capabilities.canView) return { error: "Forbidden", status: 403 } as const;
  return { actor, capabilities, supabase } as const;
}

async function withSignedUrl(row: AttachmentRow) {
  return {
    id: row.id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    url: await signTaskFile(row.storage_path),
  };
}

export async function GET(_request: Request, { params }: Ctx) {
  const timing = new RouteTiming("lead-attachments");
  const respond = (
    body: unknown,
    status = 200,
    headers?: HeadersInit,
  ) => {
    const response = NextResponse.json(body, { status, headers });
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(status);
    return response;
  };
  const { id } = await params;
  const context = await loadContext(id, timing);
  if ("error" in context) {
    return respond({ error: context.error }, context.status);
  }
  await recoverSavedAttachments("lead", id);
  const { data, error } = await timing.measure("file_rows", async () =>
    context.supabase
      .from("lead_attachments")
      .select(COLUMNS)
      .eq("lead_id", id)
      .order("created_at", { ascending: true }),
  );
  if (error) return respond({ error: error.message }, 500);
  try {
    const attachments = await timing.measure("file_sign", async () =>
      Promise.all(((data ?? []) as AttachmentRow[]).map(withSignedUrl)),
    );
    return respond(
      { attachments },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch {
    return respond({ error: "Could not load attachments." }, 500);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const context = await loadContext(id);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }
  if (!context.capabilities.canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // JSON = direct-to-Storage upload (prepare / finalize); multipart = the old
  // path, kept for tabs opened before 2026-10-21 (still capped by Vercel).
  let direct: DirectUploadRequest | null = null;
  let file: File | null = null;
  let requestId: string | null;
  if (isDirectUploadRequest(request)) {
    const parsed = await readDirectUploadRequest(request);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    direct = parsed.upload;
    requestId = direct.clientRequestId;
  } else {
    const form = await request.formData().catch(() => null);
    const formFile = form?.get("file");
    if (!(formFile instanceof File) || !formFile.name || formFile.name.length > 255) {
      return NextResponse.json({ error: "Choose a valid file." }, { status: 400 });
    }
    if (formFile.size === 0) {
      return NextResponse.json({ error: "Empty files cannot be uploaded." }, { status: 400 });
    }
    if (formFile.size > TASK_ATTACHMENT_MAX_BYTES) {
      return NextResponse.json({ error: attachmentTooLargeMessage() }, { status: 400 });
    }
    file = formFile;
    const rawRequestId = form?.get("client_request_id");
    requestId = typeof rawRequestId === "string" ? rawRequestId : null;
    if (requestId !== null && !UUID_RE.test(requestId)) {
      return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
    }
  }
  const fileName = direct ? direct.fileName : file!.name;
  const actorEmail = context.actor.email.trim().toLowerCase();
  const intent: UploadIntent | null = direct ? {
    kind: "lead",
    record_id: id,
    uploaded_by: actorEmail,
    client_request_id: direct.clientRequestId,
    comment_id: null,
    file_name: fileName,
    size_bytes: direct.size,
    storage_path: leadStoragePath(id, fileName, direct.clientRequestId),
    silent: false,
  } : null;
  if (intent && direct?.action === "finalize") {
    try {
      await requireUploadIntent(intent);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown upload." }, { status: 400 });
    }
  }
  if (requestId) {
    const { data: existing, error } = await context.supabase
      .from("lead_attachments")
      .select(COLUMNS)
      .eq("lead_id", id)
      .eq("uploaded_by", actorEmail)
      .eq("client_request_id", requestId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (existing) {
      return NextResponse.json({ attachment: await withSignedUrl(existing as AttachmentRow) });
    }
  }

  const { count, error: countError } = await context.supabase
    .from("lead_attachments")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", id);
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) >= 50) {
    return NextResponse.json({ error: "A lead can have at most 50 files." }, { status: 400 });
  }

  if (direct?.action === "prepare") {
    try {
      await reserveUploadIntent(intent!);
      const ticket = await createTaskUploadTicket(
        leadStoragePath(id, fileName, direct.clientRequestId),
      );
      return NextResponse.json(directUploadTicketBody(ticket, fileName));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not prepare the upload." },
        { status: 500 },
      );
    }
  }

  let path: string;
  let contentType: string;
  let sizeBytes: number;
  if (direct) {
    path = leadStoragePath(id, fileName, direct.clientRequestId);
    const verified = await verifyDirectUpload(path, fileName, direct.size);
    if (!verified.ok) {
      if (intent && verified.status === 400 && verified.error !== "The upload did not finish. Please try again.") {
        await failUploadIntent(intent, verified.error).catch(() => undefined);
      }
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }
    contentType = verified.contentType;
    sizeBytes = verified.size;
  } else {
    const bytes = await file!.arrayBuffer();
    const validation = validateAttachmentFile(fileName, bytes);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    path = leadStoragePath(id, fileName);
    contentType = validation.contentType;
    sizeBytes = file!.size;
    try {
      await uploadTaskFile(path, bytes, contentType);
    } catch (error) {
      await removeTaskFile(path).catch(() => undefined);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not upload attachment." },
        { status: 500 },
      );
    }
  }

  try {
    // Sign before writing metadata: a signing failure must not leave a row
    // pointing to a file the client cannot open or safely retry.
    const signedUrl = await signTaskFile(path);
    const { data, error } = await context.supabase
      .rpc("create_lead_attachment_atomic", {
        p_lead_id: id,
        p_storage_path: path,
        p_file_name: fileName,
        p_mime_type: contentType,
        p_size_bytes: sizeBytes,
        p_uploaded_by: actorEmail,
        p_client_request_id: requestId,
      })
      .single();
    if (error || !data) {
      const definiteRefusal = error?.message.includes("LEAD_ATTACHMENT_COUNT_LIMIT") ||
        error?.message.includes("ATTACHMENT_FILE_LIMIT") ||
        error?.message.includes("LEAD_NOT_FOUND");
      if (intent && definiteRefusal) {
        await failUploadIntent(intent, "Attachment could not be added to this lead.")
          .catch(() => undefined);
      }
      // A transport failure can hide a successful commit. Keep direct uploads
      // so the same request id can replay without creating a broken row.
      if (!direct || definiteRefusal) {
        await removeTaskFile(path).catch((cleanupError) =>
          console.warn("Lead attachment cleanup failed", cleanupError),
        );
      }
      if (error?.message.includes("LEAD_ATTACHMENT_COUNT_LIMIT")) {
        return NextResponse.json({ error: "A lead can have at most 50 files." }, { status: 400 });
      }
      if (error?.message.includes("ATTACHMENT_FILE_LIMIT")) {
        return NextResponse.json({ error: attachmentTooLargeMessage() }, { status: 400 });
      }
      return NextResponse.json({ error: error?.message ?? "Could not save attachment." }, { status: 500 });
    }
    const result = data as {
      attachment: AttachmentRow;
      was_created: boolean;
      replayed_path: string | null;
    };
    if (intent) {
      await completeUploadIntent(intent).catch((reason) =>
        console.warn("[lead attachment] could not mark upload intent complete", reason),
      );
    }
    const attachment = result.attachment;
    if (!result.was_created) {
      if (result.replayed_path && result.replayed_path !== path) {
        await removeTaskFile(path).catch((cleanupError) =>
          console.warn("Lead duplicate attachment cleanup failed", cleanupError),
        );
      }
      return NextResponse.json({ attachment: await withSignedUrl(attachment) });
    }
    return NextResponse.json({ attachment: {
      id: attachment.id,
      file_name: attachment.file_name,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      created_at: attachment.created_at,
      url: signedUrl,
    } }, { status: 201 });
  } catch (error) {
    // A direct upload stays so a retry can finalize it without re-uploading.
    if (!direct) await removeTaskFile(path).catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not upload attachment." },
      { status: 500 },
    );
  }
}

import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask, canMutateTask } from "@/lib/tasks/access";
import { fetchTaskAssigneeEmails, isTaskAssignee } from "@/lib/tasks/assignees";
import {
  buildStoragePath,
  createTaskUploadTicket,
  uploadTaskFile,
  signTaskFile,
  removeTaskFile,
} from "@/lib/tasks/storage";
import {
  directUploadTicketBody,
  isDirectUploadRequest,
  readDirectUploadRequest,
  verifyDirectUpload,
  type DirectUploadRequest,
} from "@/lib/tasks/direct-upload";
import { isTaskParticipant } from "@/lib/tasks/participants";
import {
  actorSeesAllTasks,
  fetchAgentAssistantEmails,
  fetchAgentsForCs,
  isAgentOwnerOrAssistant,
} from "@/lib/tasks/membership";
import {
  broadcastTaskRoom,
  broadcastTasksChanged,
  readTaskMutationSourceId,
} from "@/lib/tasks/realtime";
import { signAttachmentsSafely } from "@/lib/tasks/detail";
import { settleSideEffects } from "@/lib/tasks/mutation-result";
import {
  insertNotifications,
  uniqueNotificationRecipients,
} from "@/lib/tasks/notifications";
import type { TaskRow } from "@/lib/tasks/types";
import {
  attachmentTooLargeMessage,
  TASK_ATTACHMENT_MAX_BYTES,
  validateAttachmentFile,
} from "@/lib/tasks/attachments";
import { checkOperationLimits } from "@/lib/tasks/attachment-limits";
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
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// View access including agent membership and participants.
async function canViewResolved(
  actor: ReturnType<typeof buildTaskActor>,
  task: Pick<TaskRow, "assignee_email" | "agent_email" | "reporter_email">,
  taskId: string
): Promise<boolean> {
  if (actor.isManager) return true;
  // Plain-CS can view/attach on the shared queue; standalone task edits stay gated.
  if (await actorSeesAllTasks(actor)) return true;
  const [isParticipant, isAssignee, agents, isAgentOwner] = await Promise.all([
    isTaskParticipant(taskId, actor.email),
    isTaskAssignee(taskId, actor.email),
    fetchAgentsForCs(actor.email),
    isAgentOwnerOrAssistant(task.agent_email, actor.email),
  ]);
  const isAgentMember = Boolean(task.agent_email && agents.includes(task.agent_email));
  return canViewTask(actor, task, {
    isParticipant,
    isAgentMember,
    isAgentOwner,
    isAssignee,
    isReporter: task.reporter_email === actor.email,
  });
}

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("id,assignee_email,agent_email,reporter_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return {
    actor,
    task: data as unknown as Pick<
      TaskRow,
      "id" | "assignee_email" | "agent_email" | "reporter_email"
    >,
    supabase,
  };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!(await canViewResolved(r.actor, r.task, id)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  await recoverSavedAttachments("task", id);

  // Task-level attachments only; comment attachments live with their comment.
  // `deleted_at` is required: deletion became a soft-delete plus post-commit
  // storage removal, so an unfiltered query resurfaces files whose objects are
  // already gone. This consumer was missed when that model changed.
  const { data, error } = await r.supabase
    .from("task_attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", id)
    .is("comment_id", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Per-file isolation, same as task detail: signTaskFile throws, so the old
  // Promise.all meant one unsignable object failed the entire endpoint.
  const rows = (data ?? []) as {
    id: string;
    file_name: string;
    mime_type: string | null;
    size_bytes: number | null;
    storage_path: string;
    created_at: string;
  }[];
  const signed = await signAttachmentsSafely(rows);
  const attachments = rows.map((row, index) => ({
    ...signed[index],
    created_at: row.created_at,
  }));
  return NextResponse.json({ attachments });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  // Reject an unauthorised upload before parsing/buffering its multipart body.
  if (!(await canViewResolved(r.actor, r.task, id)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // JSON = direct-to-Storage upload (prepare / finalize); multipart = the old
  // path, kept for tabs opened before 2026-10-21 (still capped by Vercel).
  let direct: DirectUploadRequest | null = null;
  let file: File | null = null;
  let commentId: string | null;
  let silent: boolean;
  let requestId: string | null;
  if (isDirectUploadRequest(req)) {
    const parsed = await readDirectUploadRequest(req);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    direct = parsed.upload;
    commentId = direct.commentId;
    silent = direct.silent;
    requestId = direct.clientRequestId;
  } else {
    const form = await req.formData().catch(() => null);
    const formFile = form?.get("file");
    if (!(formFile instanceof File))
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    if (formFile.size > TASK_ATTACHMENT_MAX_BYTES)
      return NextResponse.json(
        { error: attachmentTooLargeMessage() },
        { status: 400 }
      );
    file = formFile;

    const rawCid = form?.get("comment_id");
    commentId = typeof rawCid === "string" && rawCid ? rawCid : null;
    silent = form?.get("silent") === "1";

    const rawRequestId = form?.get("client_request_id");
    requestId =
      typeof rawRequestId === "string" && rawRequestId ? rawRequestId : null;
    if (requestId !== null && !UUID_RE.test(requestId)) {
      return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
    }
  }
  const fileName = direct ? direct.fileName : file!.name;

  if (commentId) {
    // Comment attachment: any viewer (incl. participants) may attach to their OWN comment.
    const { data: c } = await r.supabase
      .from("task_comments")
      .select("id,task_id,author_email")
      .eq("id", commentId)
      .maybeSingle();
    const cc = c as { task_id: string; author_email: string } | null;
    if (!cc || cc.task_id !== id || cc.author_email !== r.actor.email)
      return NextResponse.json({ error: "Invalid comment." }, { status: 400 });
  } else if (
    !canMutateTask(r.actor, r.task, {
      isAgentOwner: await isAgentOwnerOrAssistant(r.task.agent_email, r.actor.email),
      isReporter: r.task.reporter_email === r.actor.email,
    })
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const intent: UploadIntent | null = direct ? {
    kind: "task",
    record_id: id,
    uploaded_by: r.actor.email,
    client_request_id: direct.clientRequestId,
    comment_id: commentId,
    file_name: fileName,
    size_bytes: direct.size,
    storage_path: buildStoragePath(id, fileName, direct.clientRequestId),
    silent,
  } : null;

  if (intent && direct?.action === "finalize") {
    try {
      await requireUploadIntent(intent);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown upload." }, { status: 400 });
    }
  }

  // A retried prepare after the file was already recorded: hand back that
  // attachment so the browser skips the upload. Finalize replays through the
  // RPC below, which keys on the same request id.
  if (direct?.action === "prepare") {
    const { data: existing, error: existingError } = await r.supabase
      .from("task_attachments")
      .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
      .eq("task_id", id)
      .eq("uploaded_by", r.actor.email)
      .eq("client_request_id", direct.clientRequestId)
      .is("deleted_at", null)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (existing) {
      const row = existing as {
        id: string;
        file_name: string;
        mime_type: string | null;
        size_bytes: number | null;
        storage_path: string;
        created_at: string;
      };
      let url: string | null = null;
      try {
        url = await signTaskFile(row.storage_path);
      } catch {
        url = null;
      }
      return NextResponse.json({
        attachment: {
          id: row.id,
          file_name: row.file_name,
          mime_type: row.mime_type,
          size_bytes: row.size_bytes,
          created_at: row.created_at,
          url,
        },
        warnings: [],
      });
    }
  }

  // Finalize trusts only the size Storage recorded, so verify the object before
  // the running limits below see it.
  let verified: { contentType: string; size: number } | null = null;
  if (direct?.action === "finalize") {
    const result = await verifyDirectUpload(
      buildStoragePath(id, fileName, direct.clientRequestId),
      fileName,
      direct.size,
    );
    if (!result.ok) {
      if (intent && result.status === 400 && result.error !== "The upload did not finish. Please try again.") {
        await failUploadIntent(intent, result.error).catch(() => undefined);
      }
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    verified = result;
  }
  const fileSize = verified ? verified.size : direct ? direct.size : file!.size;

  // Prepare can refuse early. Finalize goes to the locked RPC below: a stale
  // read here could reject a replay and delete the object its row points to.
  if (direct?.action !== "finalize") {
    let existingQuery = r.supabase
      .from("task_attachments")
      .select("size_bytes")
      .eq("task_id", id)
      .is("deleted_at", null);
    existingQuery = commentId
      ? existingQuery.eq("comment_id", commentId)
      : existingQuery.is("comment_id", null);
    // A replayed finalize must not count its own already-recorded row twice.
    if (requestId) {
      existingQuery = existingQuery.or(
        `client_request_id.is.null,client_request_id.neq.${requestId}`,
      );
    }
    const { data: existing, error: existingError } = await existingQuery;
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    const existingSizes = ((existing ?? []) as { size_bytes: number | null }[]).map(
      (row) => row.size_bytes ?? 0,
    );
    const limits = checkOperationLimits({ textLength: 0, sizes: [...existingSizes, fileSize] });
    if (!limits.ok) {
      return NextResponse.json({ error: limits.message }, { status: 400 });
    }
  }

  if (direct?.action === "prepare") {
    try {
      await reserveUploadIntent(intent!);
      const ticket = await createTaskUploadTicket(
        buildStoragePath(id, fileName, direct.clientRequestId),
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
  if (verified && direct) {
    path = buildStoragePath(id, fileName, direct.clientRequestId);
    contentType = verified.contentType;
  } else {
    const fileData = await file!.arrayBuffer();
    const validation = validateAttachmentFile(fileName, fileData);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    path = buildStoragePath(id, fileName);
    contentType = validation.contentType;
    try {
      await uploadTaskFile(path, fileData, contentType);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not upload attachment.",
        },
        { status: 500 }
      );
    }
  }

  // Sign before the metadata transaction. A signing outage must not leave a
  // durable row followed by a misleading 500 response.
  let uploadedUrl: string;
  try {
    uploadedUrl = await signTaskFile(path);
  } catch {
    // A direct upload stays so a retry can finalize it without re-uploading.
    if (!direct) {
      await removeTaskFile(path).catch((cleanupError) =>
        console.warn("[attachment] failed to compensate unsigned upload", cleanupError)
      );
    }
    return NextResponse.json(
      { error: "Could not prepare the attachment link. Please try again." },
      { status: 500 }
    );
  }

  const { data: created, error } = await r.supabase
    .rpc("create_task_attachment_atomic", {
      p_task_id: id,
      p_comment_id: commentId,
      p_storage_path: path,
      p_file_name: fileName,
      p_mime_type: contentType,
      p_size_bytes: fileSize,
      p_uploaded_by: r.actor.email,
      p_client_request_id: requestId,
    })
    .single();
  if (error) {
    const limitMessage = error.message.includes("ATTACHMENT_AGGREGATE_LIMIT")
      ? "Attachments are too large in total (max 250MB)."
      : error.message.includes("ATTACHMENT_COUNT_LIMIT")
        ? "Too many files (max 50 per comment)."
        : error.message.includes("ATTACHMENT_FILE_LIMIT")
          ? attachmentTooLargeMessage()
          : null;
    // An unknown RPC/transport error may arrive after the transaction commits.
    // The direct object has a stable path and must survive for an idempotent
    // retry; only a definite refusal makes it safe to remove.
    const definiteRefusal = Boolean(limitMessage) ||
      error.message.includes("INVALID_COMMENT") ||
      error.message.includes("TASK_NOT_FOUND");
    if (intent && definiteRefusal) {
      await failUploadIntent(intent, limitMessage ?? "Attachment could not be added to this comment or task.")
        .catch(() => undefined);
    }
    if (!direct || definiteRefusal) {
      await removeTaskFile(path).catch((cleanupError) =>
        console.warn("[attachment] failed to compensate uncommitted upload", cleanupError)
      );
    }
    if (limitMessage) {
      return NextResponse.json({ error: limitMessage }, { status: 400 });
    }
    if (error.message.includes("INVALID_COMMENT")) {
      return NextResponse.json({ error: "Invalid comment." }, { status: 400 });
    }
    if (error.message.includes("TASK_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = created as {
    attachment: {
      id: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      created_at: string;
      storage_path?: string;
    };
    was_created: boolean;
    replayed_path: string | null;
  };
  if (intent) {
    await completeUploadIntent(intent).catch((reason) =>
      console.warn("[attachment] could not mark upload intent complete", reason),
    );
  }
  const warnings = [] as { code: string; message: string }[];
  let url: string | null = uploadedUrl;
  if (!result.was_created) {
    const replayedPath = result.replayed_path;
    if (replayedPath && replayedPath !== path) {
      warnings.push(
        ...(await settleSideEffects([
          {
            code: "duplicate_upload_cleanup_failed",
            message: "The original attachment was kept, but the retried upload could not be cleaned up.",
            run: () => removeTaskFile(path),
          },
        ])),
      );
      try {
        url = await signTaskFile(replayedPath);
      } catch {
        url = null;
        warnings.push({
          code: "attachment_sign_failed",
          message: "The attachment was saved but its download link is temporarily unavailable.",
        });
      }
    }
    return NextResponse.json({
      attachment: {
        id: result.attachment.id,
        file_name: result.attachment.file_name,
        mime_type: result.attachment.mime_type,
        size_bytes: result.attachment.size_bytes,
        created_at: result.attachment.created_at,
        url,
      },
      warnings,
    });
  }

  const sideEffects = [
    {
      code: "broadcast_failed",
      message: "Other open tabs may need a refresh to see this attachment.",
      run: async () => {
        const delivered = await Promise.all([
          broadcastTaskRoom(id, readTaskMutationSourceId(req)),
          // Pass the caller's source id so the originating tab can skip its own
          // tasks-only echo. Missing source ids also remain tasks-only here;
          // comments and attachments never change task categories.
          broadcastTasksChanged(readTaskMutationSourceId(req)),
        ]);
        return delivered.every(Boolean);
      },
    },
  ];
  if (!commentId && !silent) {
    sideEffects.push({
      code: "notification_failed",
      message: "The attachment was saved but some people may not have been notified.",
      run: async () => {
        const [assignees, agentRecipients] = await Promise.all([
          fetchTaskAssigneeEmails(id, r.supabase),
          // Phụ tá, không gồm agent: agent thôi nhận thông báo tự động.
          fetchAgentAssistantEmails(r.task.agent_email),
        ]);
        const recipients = uniqueNotificationRecipients(
          [...assignees, r.task.reporter_email, ...agentRecipients],
          [r.actor.email]
        );
        return insertNotifications(
          recipients.map((recipient) => ({
            recipient_email: recipient,
            task_id: id,
            type: "attachment_added",
            actor_email: r.actor.email,
            detail: fileName,
          }))
        );
      },
    });
  }
  after(async () => {
    const sideEffectWarnings = await settleSideEffects(sideEffects);
    if (sideEffectWarnings.length > 0) {
      console.error("Task attachment committed with side-effect warnings", {
        taskId: id,
        warnings: sideEffectWarnings,
      });
    }
  });

  return NextResponse.json({
    attachment: {
      id: result.attachment.id,
      file_name: result.attachment.file_name,
      mime_type: result.attachment.mime_type,
      size_bytes: result.attachment.size_bytes,
      created_at: result.attachment.created_at,
      url,
    },
    warnings,
  });
}

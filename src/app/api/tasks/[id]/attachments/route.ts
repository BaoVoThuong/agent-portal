import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canViewTask, canMutateTask } from "@/lib/tasks/access";
import { fetchTaskAssigneeEmails, isTaskAssignee } from "@/lib/tasks/assignees";
import {
  buildStoragePath,
  uploadTaskFile,
  signTaskFile,
  removeTaskFile,
} from "@/lib/tasks/storage";
import { isTaskParticipant } from "@/lib/tasks/participants";
import {
  actorSeesAllTasks,
  fetchAgentOwnerAndAssistantEmails,
  fetchAgentsForCs,
  isAgentOwnerOrAssistant,
} from "@/lib/tasks/membership";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
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

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// View access including agent membership and participants.
async function canViewResolved(
  actor: ReturnType<typeof buildTaskActor>,
  task: Pick<TaskRow, "assignee_email" | "agent_email">,
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
  });
}

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
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

  // Task-level attachments only; comment attachments live with their comment.
  const { data, error } = await r.supabase
    .from("task_attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", id)
    .is("comment_id", null)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const attachments = await Promise.all(
    (data ?? []).map(async (a) => {
      const row = a as {
        id: string;
        file_name: string;
        mime_type: string | null;
        size_bytes: number | null;
        storage_path: string;
        created_at: string;
      };
      return {
        id: row.id,
        file_name: row.file_name,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        created_at: row.created_at,
        url: await signTaskFile(row.storage_path),
      };
    })
  );
  return NextResponse.json({ attachments });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  // Reject an unauthorised upload before parsing/buffering its multipart body.
  if (!(await canViewResolved(r.actor, r.task, id)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > TASK_ATTACHMENT_MAX_BYTES)
    return NextResponse.json(
      { error: attachmentTooLargeMessage() },
      { status: 400 }
    );

  const rawCid = form?.get("comment_id");
  const commentId = typeof rawCid === "string" && rawCid ? rawCid : null;

  const rawRequestId = form?.get("client_request_id");
  const requestId =
    typeof rawRequestId === "string" && rawRequestId ? rawRequestId : null;
  if (requestId !== null && !UUID_RE.test(requestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

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

  const fileData = await file.arrayBuffer();
  const validation = validateAttachmentFile(file.name, fileData);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const path = buildStoragePath(id, file.name);
  try {
    await uploadTaskFile(path, fileData, validation.contentType);
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

  // Sign before the metadata transaction. A signing outage must not leave a
  // durable row followed by a misleading 500 response.
  let uploadedUrl: string;
  try {
    uploadedUrl = await signTaskFile(path);
  } catch {
    await removeTaskFile(path).catch((cleanupError) =>
      console.warn("[attachment] failed to compensate unsigned upload", cleanupError)
    );
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
      p_file_name: file.name,
      p_mime_type: validation.contentType,
      p_size_bytes: file.size,
      p_uploaded_by: r.actor.email,
      p_client_request_id: requestId,
    })
    .single();
  if (error) {
    await removeTaskFile(path).catch((cleanupError) =>
      console.warn("[attachment] failed to compensate uncommitted upload", cleanupError)
    );
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
        await broadcastTaskRoom(id);
        await broadcastTasksChanged();
      },
    },
  ];
  if (!commentId) {
    sideEffects.push({
      code: "notification_failed",
      message: "The attachment was saved but some people may not have been notified.",
      run: async () => {
        const [assignees, agentRecipients] = await Promise.all([
          fetchTaskAssigneeEmails(id, r.supabase),
          fetchAgentOwnerAndAssistantEmails(r.task.agent_email),
        ]);
        const recipients = uniqueNotificationRecipients(
          [...assignees, r.task.reporter_email, ...agentRecipients],
          [r.actor.email]
        );
        await insertNotifications(
          recipients.map((recipient) => ({
            recipient_email: recipient,
            task_id: id,
            type: "attachment_added",
            actor_email: r.actor.email,
            detail: file.name,
          }))
        );
      },
    });
  }
  warnings.push(...(await settleSideEffects(sideEffects)));

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

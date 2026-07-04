import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask, canMutateTask } from "@/lib/tasks/access";
import { isTaskAssignee } from "@/lib/tasks/assignees";
import { buildStoragePath, uploadTaskFile, signTaskFile } from "@/lib/tasks/storage";
import { isTaskParticipant } from "@/lib/tasks/participants";
import { fetchAgentsForCs } from "@/lib/tasks/membership";
import { broadcastTaskRoom } from "@/lib/tasks/realtime";
import type { TaskRow } from "@/lib/tasks/types";
import {
  attachmentTooLargeMessage,
  inferAttachmentMimeType,
  TASK_ATTACHMENT_MAX_BYTES,
} from "@/lib/tasks/attachments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// View access including agent membership and participants.
async function canViewResolved(
  actor: ReturnType<typeof buildTaskActor>,
  task: Pick<TaskRow, "assignee_email" | "agent_email">,
  taskId: string
): Promise<boolean> {
  if (actor.isManager) return true;
  const [isParticipant, isAssignee, agents] = await Promise.all([
    isTaskParticipant(taskId, actor.email),
    isTaskAssignee(taskId, actor.email),
    fetchAgentsForCs(actor.email),
  ]);
  const isAgentMember = Boolean(task.agent_email && agents.includes(task.agent_email));
  const isAgentOwner = Boolean(task.agent_email && task.agent_email === actor.email);
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
  const actor = buildTaskActor(session.user.permissions, email);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("id,assignee_email,agent_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return { actor, task: data as unknown as Pick<TaskRow, "id" | "assignee_email" | "agent_email">, supabase };
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

  if (commentId) {
    // Comment attachment: any viewer (incl. participants) may attach to their OWN comment.
    if (!(await canViewResolved(r.actor, r.task, id)))
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    const { data: c } = await r.supabase
      .from("task_comments")
      .select("id,task_id,author_email")
      .eq("id", commentId)
      .maybeSingle();
    const cc = c as { task_id: string; author_email: string } | null;
    if (!cc || cc.task_id !== id || cc.author_email !== r.actor.email)
      return NextResponse.json({ error: "Invalid comment." }, { status: 400 });
  } else if (
    !canMutateTask(
      r.actor,
      r.task,
      Boolean(r.task.agent_email && r.task.agent_email === r.actor.email)
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const path = buildStoragePath(id, file.name);
  const contentType = inferAttachmentMimeType(file.name, file.type);
  try {
    await uploadTaskFile(path, await file.arrayBuffer(), contentType);
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

  const { data, error } = await r.supabase
    .from("task_attachments")
    .insert({
      task_id: id,
      comment_id: commentId,
      storage_path: path,
      file_name: file.name,
      mime_type: contentType,
      size_bytes: file.size,
      uploaded_by: r.actor.email,
    })
    .select("id,file_name,mime_type,size_bytes,created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (commentId) {
    await broadcastTaskRoom(id);
  } else {
    await r.supabase.from("task_activity").insert({
      task_id: id,
      actor_email: r.actor.email,
      type: "attachment_added",
      meta: { file_name: file.name },
    });
  }

  return NextResponse.json({
    attachment: { ...(data as object), url: await signTaskFile(path) },
  });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask } from "@/lib/tasks/access";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";
import { resolveCommentRecipients, insertNotifications } from "@/lib/tasks/notifications";
import { parseMentions } from "@/lib/tasks/mentions";
import { addParticipants, isTaskParticipant } from "@/lib/tasks/participants";
import { fetchAgentsForCs } from "@/lib/tasks/membership";
import { broadcastTaskRoom } from "@/lib/tasks/realtime";
import { signTaskFile } from "@/lib/tasks/storage";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const COMMENT_COLUMNS =
  "id,task_id,parent_id,author_email,body,created_at,updated_at,deleted_at";

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("id,status,assignee_email,agent_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return { actor, task: data as unknown as Pick<TaskRow, "id" | "status" | "assignee_email" | "agent_email">, supabase };
}

// View access including participants and agent membership.
async function canViewResolved(
  actor: ReturnType<typeof buildTaskActor>,
  task: Pick<TaskRow, "assignee_email" | "agent_email">,
  taskId: string
): Promise<boolean> {
  if (actor.isManager) return true;
  const [isParticipant, agents] = await Promise.all([
    isTaskParticipant(taskId, actor.email),
    fetchAgentsForCs(actor.email),
  ]);
  const isAgentMember = Boolean(task.agent_email && agents.includes(task.agent_email));
  return canViewTask(actor, task, { isParticipant, isAgentMember });
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!(await canViewResolved(r.actor, r.task, id)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await r.supabase
    .from("task_comments")
    .select(COMMENT_COLUMNS)
    .eq("task_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attachments that belong to a comment (task-level ones stay in AttachmentPanel).
  const { data: attData } = await r.supabase
    .from("task_attachments")
    .select("id,comment_id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", id)
    .not("comment_id", "is", null)
    .order("created_at", { ascending: true });

  const signed = await Promise.all(
    (attData ?? []).map(async (a) => {
      const row = a as {
        id: string; comment_id: string; file_name: string;
        mime_type: string | null; size_bytes: number | null; storage_path: string;
      };
      return {
        comment_id: row.comment_id,
        att: {
          id: row.id, file_name: row.file_name, mime_type: row.mime_type,
          size_bytes: row.size_bytes, url: await signTaskFile(row.storage_path),
        },
      };
    })
  );
  const byComment = new Map<string, { id: string; file_name: string; mime_type: string | null; size_bytes: number | null; url: string }[]>();
  for (const { comment_id, att } of signed) {
    const list = byComment.get(comment_id) ?? [];
    list.push(att);
    byComment.set(comment_id, list);
  }

  const comments = (data ?? []).map((c) => {
    const row = c as { id: string };
    return { ...(c as object), attachments: byComment.get(row.id) ?? [] };
  });
  return NextResponse.json({ comments });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!(await canViewResolved(r.actor, r.task, id)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  const hasAttachments = body?.hasAttachments === true;
  if (!text && !hasAttachments)
    return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  // Validate parent: must be a top-level comment on THIS task (one-level threading).
  let parentId: string | null = null;
  if (typeof body?.parentId === "string" && body.parentId) {
    const { data: parent } = await r.supabase
      .from("task_comments")
      .select("id,task_id,parent_id")
      .eq("id", body.parentId)
      .maybeSingle();
    const p = parent as { task_id: string; parent_id: string | null } | null;
    if (!p || p.task_id !== id || p.parent_id !== null)
      return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
    parentId = body.parentId;
  }

  const { data: comment, error } = await r.supabase
    .from("task_comments")
    .insert({ task_id: id, parent_id: parentId, author_email: r.actor.email, body: text })
    .select(COMMENT_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await r.supabase.from("task_activity").insert({
    task_id: id,
    actor_email: r.actor.email,
    type: "comment_added",
    meta: null,
  });

  // Mentions are parsed from the body (server is the source of truth), then
  // validated against board members. Mentioned members become participants (so
  // they can see the task) and get notified.
  const memberEmails = new Set((await fetchTaskAssignees()).map((m) => m.email));
  const validMentions = parseMentions(text).filter((m) => memberEmails.has(m));
  if (validMentions.length > 0) await addParticipants(id, validMentions, "mention");

  const recipients = resolveCommentRecipients(r.task, r.actor.email, validMentions);
  await insertNotifications(
    recipients.map((rec) => ({
      recipient_email: rec.email,
      task_id: id,
      type: rec.type,
      actor_email: r.actor.email,
      comment_id: (comment as { id: string }).id,
    }))
  );

  await broadcastTaskRoom(id);
  return NextResponse.json({ comment });
}

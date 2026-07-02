import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask } from "@/lib/tasks/access";
import { isTaskAssignee } from "@/lib/tasks/assignees";
import { fetchAgentsForCs } from "@/lib/tasks/membership";
import { isTaskParticipant } from "@/lib/tasks/participants";
import { broadcastTaskRoom } from "@/lib/tasks/realtime";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };
const COMMENT_COLUMNS =
  "id,task_id,parent_id,author_email,body,created_at,updated_at,deleted_at";

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

async function loadAuthorContext(id: string, cid: string) {
  // 1. Session / email
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };

  const actor = buildTaskActor(session.user.permissions, email);
  const supabase = getSupabaseAdmin();

  // 2. Load comment (id, author_email, task_id)
  const { data: comment, error: cErr } = await supabase
    .from("task_comments")
    .select("id,author_email,task_id")
    .eq("id", cid)
    .maybeSingle();
  if (cErr) return { error: cErr.message, status: 500 };
  if (!comment) return { error: "Not found", status: 404 };

  // 3. Comment must belong to the route task
  const cmnt = comment as { id: string; author_email: string; task_id: string };
  if (cmnt.task_id !== id) return { error: "Not found", status: 404 };

  // 4. Actor must be able to view the task
  const { data: task, error: tErr } = await supabase
    .from("tasks")
    .select("id,assignee_email,agent_email")
    .eq("id", id)
    .maybeSingle();
  if (tErr) return { error: tErr.message, status: 500 };
  if (!task) return { error: "Not found", status: 404 };
  if (
    !(await canViewResolved(
      actor,
      task as Pick<TaskRow, "assignee_email" | "agent_email">,
      id
    ))
  )
    return { error: "Forbidden", status: 403 };

  // 5. Actor must be the comment author
  if (cmnt.author_email !== email) return { error: "Forbidden", status: 403 };

  return { supabase, email };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, cid } = await params;
  const ctx = await loadAuthorContext(id, cid);
  if ("error" in ctx)
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text)
    return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  const { data, error } = await ctx.supabase
    .from("task_comments")
    .update({ body: text, updated_at: new Date().toISOString() })
    .eq("id", cid)
    .select(COMMENT_COLUMNS)
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  await broadcastTaskRoom(id);
  return NextResponse.json({ comment: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, cid } = await params;
  const ctx = await loadAuthorContext(id, cid);
  if ("error" in ctx)
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { error } = await ctx.supabase
    .from("task_comments")
    .update({ deleted_at: new Date().toISOString(), body: "" })
    .eq("id", cid);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  await broadcastTaskRoom(id);
  return NextResponse.json({ ok: true });
}

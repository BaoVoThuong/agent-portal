import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canViewTask } from "@/lib/tasks/access";
import { isTaskAssignee } from "@/lib/tasks/assignees";
import { fetchAgentsForCs } from "@/lib/tasks/membership";
import { isTaskParticipant } from "@/lib/tasks/participants";
import { removeTaskFile } from "@/lib/tasks/storage";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; aid: string }> };

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

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, aid } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });

  const supabase = getSupabaseAdmin();
  const { data: task } = await supabase
    .from("tasks")
    .select("id,assignee_email,agent_email")
    .eq("id", id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (
    !(await canViewResolved(
      actor,
      task as Pick<TaskRow, "assignee_email" | "agent_email">,
      id
    ))
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data: att } = await supabase
    .from("task_attachments")
    .select("id,task_id,storage_path,uploaded_by")
    .eq("id", aid)
    .maybeSingle();
  const attachment = att as
    | { task_id: string; storage_path: string; uploaded_by: string | null }
    | null;
  if (!attachment || attachment.task_id !== id)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Uploader or manager only.
  if (!actor.isManager && attachment.uploaded_by !== email)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await removeTaskFile(attachment.storage_path);
  const { error } = await supabase.from("task_attachments").delete().eq("id", aid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

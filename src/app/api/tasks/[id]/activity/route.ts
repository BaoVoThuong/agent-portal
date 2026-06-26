import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask } from "@/lib/tasks/access";
import { isTaskParticipant } from "@/lib/tasks/participants";
import { fetchAgentsForCs } from "@/lib/tasks/membership";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// View access including agent membership and participants.
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
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);

  const supabase = getSupabaseAdmin();
  const { data: task } = await supabase
    .from("tasks")
    .select("id,assignee_email,agent_email")
    .eq("id", id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canViewResolved(actor, task as Pick<TaskRow, "assignee_email" | "agent_email">, id)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await supabase
    .from("task_activity")
    .select("id,actor_email,type,meta,created_at")
    .eq("task_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ activity: data ?? [] });
}

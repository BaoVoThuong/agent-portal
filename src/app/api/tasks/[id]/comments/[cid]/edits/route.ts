import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canViewTask } from "@/lib/tasks/access";
import { isTaskAssignee } from "@/lib/tasks/assignees";
import { fetchAgentsForCs } from "@/lib/tasks/membership";
import { isTaskParticipant } from "@/lib/tasks/participants";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

// Edit history of a comment — visible to anyone who can view the task (not just
// the author), for transparency. Returns the pre-edit body snapshots.
export async function GET(_req: Request, { params }: Ctx) {
  const { id, cid } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  const supabase = getSupabaseAdmin();

  const { data: comment } = await supabase
    .from("task_comments")
    .select("task_id")
    .eq("id", cid)
    .maybeSingle();
  if (!comment || (comment as { task_id: string }).task_id !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("id,assignee_email,agent_email")
    .eq("id", id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const taskScope = task as Pick<TaskRow, "assignee_email" | "agent_email">;

  if (!actor.isManager) {
    const [isParticipant, isAssignee, agents] = await Promise.all([
      isTaskParticipant(id, actor.email),
      isTaskAssignee(id, actor.email),
      fetchAgentsForCs(actor.email),
    ]);
    const isAgentMember = Boolean(
      taskScope.agent_email && agents.includes(taskScope.agent_email)
    );
    const isAgentOwner = Boolean(
      taskScope.agent_email && taskScope.agent_email === actor.email
    );
    if (
      !canViewTask(actor, taskScope, {
        isParticipant,
        isAssignee,
        isAgentMember,
        isAgentOwner,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { data, error } = await supabase
    .from("task_comment_edits")
    .select("id,previous_body,edited_by,edited_at")
    .eq("comment_id", cid)
    .order("edited_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ edits: data ?? [] });
}

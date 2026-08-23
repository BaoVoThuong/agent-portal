import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canViewTask } from "@/lib/tasks/access";
import { isTaskAssignee } from "@/lib/tasks/assignees";
import { actorSeesAllTasks, fetchAgentsForCs } from "@/lib/tasks/membership";
import { isTaskParticipant } from "@/lib/tasks/participants";
import { removeTaskFile } from "@/lib/tasks/storage";
import { settleSideEffects } from "@/lib/tasks/mutation-result";
import {
  broadcastTaskRoom,
  broadcastTasksChanged,
  readTaskMutationSourceId,
} from "@/lib/tasks/realtime";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; aid: string }> };

async function canViewResolved(
  actor: ReturnType<typeof buildTaskActor>,
  task: Pick<TaskRow, "assignee_email" | "agent_email" | "reporter_email">,
  taskId: string
): Promise<boolean> {
  if (actor.isManager) return true;
  if (await actorSeesAllTasks(actor)) return true;
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
    isReporter: task.reporter_email === actor.email,
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
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
    .select("id,assignee_email,agent_email,reporter_email")
    .eq("id", id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (
    !(await canViewResolved(
      actor,
      task as Pick<
        TaskRow,
        "assignee_email" | "agent_email" | "reporter_email"
      >,
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

  const { data: deleted, error } = await supabase
    .rpc("delete_task_attachment_atomic", {
      p_attachment_id: aid,
      p_actor_email: email,
    })
    .single();
  if (error) {
    if (error.message.includes("ATTACHMENT_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const warnings = await settleSideEffects([
    {
      code: "storage_cleanup_failed",
      message: "The file record was removed but the stored file could not be deleted.",
      run: () => removeTaskFile((deleted as { storage_path: string }).storage_path),
    },
    {
      code: "broadcast_failed",
      message: "Other open tabs may show a stale attachment count until they refresh.",
      run: async () => {
        const delivered = await Promise.all([
          broadcastTaskRoom(id),
          // Pass the caller's source id so the originating tab can skip its own
          // tasks-only echo. Missing source ids also remain tasks-only here;
          // comments and attachments never change task categories.
          broadcastTasksChanged(readTaskMutationSourceId(req)),
        ]);
        return delivered.every(Boolean);
      },
    },
  ]);

  return NextResponse.json({ ok: true, warnings });
}

import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildTaskActor, canAssign } from "@/lib/tasks/access";
import { fetchTasksForActor } from "@/lib/tasks/queries";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";
import { TaskBoardClient } from "./_components/TaskBoardClient";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const session = await requireAnyPermission([
    PERMISSIONS.TASK_MANAGE,
    PERMISSIONS.TASK_WORK,
  ]);
  const email = session.user.email ?? "";
  const actor = buildTaskActor(session.user.permissions, email);

  const tasks = await fetchTasksForActor(actor);
  const assignees = canAssign(actor) ? await fetchTaskAssignees() : [];

  return (
    <TaskBoardClient
      initialTasks={tasks}
      isManager={actor.isManager}
      currentEmail={email}
      assignees={assignees}
    />
  );
}

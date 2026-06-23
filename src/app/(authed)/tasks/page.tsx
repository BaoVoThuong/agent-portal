import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildTaskActor } from "@/lib/tasks/access";
import { TaskBoardPlaceholder } from "./_components/TaskBoardPlaceholder";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const session = await requireAnyPermission([
    PERMISSIONS.TASK_MANAGE,
    PERMISSIONS.TASK_WORK,
  ]);
  const actor = buildTaskActor(
    session.user.permissions,
    session.user.email ?? ""
  );

  return <TaskBoardPlaceholder isManager={actor.isManager} />;
}

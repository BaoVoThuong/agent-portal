import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildTaskActor, canAssign } from "@/lib/tasks/access";
import { fetchTasksForActor } from "@/lib/tasks/queries";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";
import { TaskBoardClient } from "./_components/TaskBoardClient";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TaskCategory } from "@/lib/tasks/types";

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

  const { data: categoryRows } = await getSupabaseAdmin()
    .from("task_categories")
    .select("id,name,color")
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  const categories = (categoryRows ?? []) as TaskCategory[];

  return (
    <TaskBoardClient
      initialTasks={tasks}
      isManager={actor.isManager}
      currentEmail={email}
      assignees={assignees}
      initialCategories={categories}
    />
  );
}

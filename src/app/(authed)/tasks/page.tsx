import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildTaskActor } from "@/lib/tasks/access";
import { fetchTasksForActor } from "@/lib/tasks/queries";
import {
  fetchTaskAgentCandidates,
  fetchTaskAgents,
  fetchTaskAssignees,
} from "@/lib/tasks/assignees";
import {
  fetchAgentsForCs,
  fetchAssistantAgentsForCs,
  fetchCsForAgent,
} from "@/lib/tasks/membership";
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
  const assignees = await fetchTaskAssignees();
  const agents = await fetchTaskAgents();
  const agentCandidates = await fetchTaskAgentCandidates();
  const myAgents = actor.isManager
    ? agents.map((a) => a.email)
    : await fetchAgentsForCs(email);
  const myAssistantAgents = actor.isManager ? [] : await fetchAssistantAgentsForCs(email);
  const agentEmailsForMembers = [
    ...new Set(
      [
        ...agents.map((agent) => agent.email),
        ...tasks.map((task) => task.agent_email).filter(Boolean),
        ...myAgents,
      ] as string[]
    ),
  ];
  const agentMembersByAgent = Object.fromEntries(
    await Promise.all(
      agentEmailsForMembers.map(async (agentEmail) => [
        agentEmail,
        await fetchCsForAgent(agentEmail),
      ])
    )
  );

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
      agents={agents}
      agentCandidates={agentCandidates}
      myAgents={myAgents}
      myAssistantAgents={myAssistantAgents}
      agentMembersByAgent={agentMembersByAgent}
      initialCategories={categories}
    />
  );
}

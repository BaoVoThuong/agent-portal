import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildTaskActor, isTaskViewAdmin } from "@/lib/tasks/access";
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
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });

  // Wave 1 — every independent fetch in parallel (was ~7 sequential awaits).
  const [
    tasks,
    assignees,
    agents,
    agentCandidates,
    csAgents,
    myAssistantAgents,
    categories,
  ] = await Promise.all([
    fetchTasksForActor(actor),
    fetchTaskAssignees(),
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    actor.isManager ? Promise.resolve<string[]>([]) : fetchAgentsForCs(email),
    actor.isManager
      ? Promise.resolve<string[]>([])
      : fetchAssistantAgentsForCs(email),
    getSupabaseAdmin()
      .from("task_categories")
      .select("id,name,color")
      .eq("is_active", true)
      .order("position", { ascending: true })
      .order("name", { ascending: true })
      .then((r) => (r.data ?? []) as TaskCategory[]),
  ]);
  const myAgents = actor.isManager ? agents.map((a) => a.email) : csAgents;

  // Wave 2 — depends on wave 1 (agents + tasks + myAgents).
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
  const boardTitle = getTaskBoardTitle({
    isAdmin: isTaskViewAdmin(session.user),
    isTaskAgent: agents.some((agent) => agent.email === email),
    isAssistant: myAssistantAgents.length > 0,
  });
  const initialNowIso = new Date().toISOString();

  return (
    <TaskBoardClient
      initialTasks={tasks}
      initialNowIso={initialNowIso}
      boardTitle={boardTitle}
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

function getTaskBoardTitle({
  isAdmin,
  isTaskAgent,
  isAssistant,
}: {
  isAdmin: boolean;
  isTaskAgent: boolean;
  isAssistant: boolean;
}) {
  if (isAdmin) return "Admin Task Board";
  if (isTaskAgent) return "Agent Task Board";
  if (isAssistant) return "Assistant Task Board";
  return "Customer Service Task Board";
}

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
import {
  LEGACY_SUPER_ADMIN_ROLE_NAME,
  SYSTEM_ROLE_NAMES,
} from "@/lib/rbac/system-roles";

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
  const boardTitle = getTaskBoardTitle({
    legacyRole: session.user.role ?? null,
    roleNames: session.user.roles ?? [],
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
  legacyRole,
  roleNames,
  isTaskAgent,
  isAssistant,
}: {
  legacyRole: string | null;
  roleNames: string[];
  isTaskAgent: boolean;
  isAssistant: boolean;
}) {
  const isAdmin =
    legacyRole === "admin" ||
    roleNames.includes(SYSTEM_ROLE_NAMES.SUPER_ADMIN) ||
    roleNames.includes(LEGACY_SUPER_ADMIN_ROLE_NAME);

  if (isAdmin) return "Admin Task Board";
  if (isTaskAgent) return "Agent Task Board";
  if (isAssistant) return "Assistant Task Board";
  return "Customer Service Task Board";
}

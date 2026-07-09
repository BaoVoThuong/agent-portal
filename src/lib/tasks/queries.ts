import { getSupabaseAdmin } from "@/lib/supabase";
import { attachAssigneesToTasks, fetchAssignedTaskIdsForEmail } from "./assignees";
import { canViewTask } from "./access";
import { fetchAgentsForCs, fetchAssistantAgentsForCs } from "./membership";
import { fetchParticipantTaskIds } from "./participants";
import type { TaskActor, TaskRow } from "./types";

export const TASK_COLUMNS =
  "id,title,description,fub_link,status,priority,category_id,agent_email,assignee_email,reporter_email,todo_started_at,in_progress_at,overdue_flagged_at,waiting_started_at,waiting_reminded_at,overdue_reminded_at,sla_minutes,overdue_count,done_reviewed_by_email,done_reviewed_at,closed_at,position,created_at,updated_at,archived_at";

export async function fetchTasksForActor(actor: TaskActor): Promise<TaskRow[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  // Manager sees everything; worker sees their own assigned tasks plus any task
  // they participate in (e.g. were @mentioned on).
  let workerScope:
    | {
        agents: string[];
        assistantAgents: string[];
        participantIds: string[];
      }
    | null = null;
  if (!actor.isManager) {
    const [agents, assistantAgents, assignedIds, participantIds] = await Promise.all([
      fetchAgentsForCs(actor.email),
      fetchAssistantAgentsForCs(actor.email),
      fetchAssignedTaskIdsForEmail(actor.email, supabase),
      fetchParticipantTaskIds(actor.email),
    ]);
    workerScope = { agents, assistantAgents, participantIds };
    const ors: string[] = [`assignee_email.eq."${actor.email}"`];
    ors.push(`agent_email.eq."${actor.email}"`);
    if (agents.length > 0) ors.push(`agent_email.in.(${agents.map((a) => `"${a}"`).join(",")})`);
    if (assignedIds.length > 0) ors.push(`id.in.(${assignedIds.join(",")})`);
    if (participantIds.length > 0) ors.push(`id.in.(${participantIds.join(",")})`);
    query =
      ors.length > 0
        ? query.or(ors.join(","))
        : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const tasks = await attachAssigneesToTasks(
    (data ?? []) as unknown as TaskRow[],
    supabase,
    { currentEmail: actor.email }
  );

  if (!workerScope) return tasks;

  const participantIdSet = new Set(workerScope.participantIds);
  return tasks
    .map((task) => ({
      ...task,
      viewer_is_participant: participantIdSet.has(task.id),
    }))
    .filter((task) => {
      const effectiveAssigneeEmail = task.assignees[0] ?? task.assignee_email;
      return canViewTask(actor, { assignee_email: effectiveAssigneeEmail }, {
        isAssignee:
          task.assignees.includes(actor.email) ||
          task.assignee_email === actor.email,
        isAgentMember: Boolean(
          task.agent_email && workerScope.agents.includes(task.agent_email)
        ),
        isAgentOwner: Boolean(
          task.agent_email &&
            (task.agent_email === actor.email ||
              workerScope.assistantAgents.includes(task.agent_email))
        ),
        isParticipant: task.viewer_is_participant,
      });
    });
}

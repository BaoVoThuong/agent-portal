import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchSelectedAgentEmails } from "./assignees";
import type { TaskActor } from "./types";

// NOTE: byte-for-byte the same query as fetchAssistantAgentsForCs below, but the
// two are read differently: an empty list here only ever REMOVES an OR-branch or
// clears isAgentMember, i.e. it denies access, so returning [] on error stays
// fail-closed and is left as-is. Worth collapsing the two helpers, but that is a
// naming decision, not a security one — see the 23/08 review, HIGH-01.
export async function fetchAgentsForCs(email: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("agent_email")
    .eq("cs_email", email)
    .eq("is_assistant", true);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => (r as { agent_email: string }).agent_email))];
}

export function groupAssistantMembers(
  rows: Array<{ agent_email: string; cs_email: string }>,
  agentEmails: string[]
): Record<string, string[]> {
  const byAgent = new Map<string, Set<string>>();
  for (const email of agentEmails) {
    if (email) byAgent.set(email, new Set());
  }

  for (const row of rows) {
    if (!row.agent_email || !row.cs_email) continue;
    const members = byAgent.get(row.agent_email) ?? new Set<string>();
    members.add(row.cs_email);
    byAgent.set(row.agent_email, members);
  }

  return Object.fromEntries(
    [...byAgent.entries()].map(([agentEmail, members]) => [
      agentEmail,
      [...members],
    ])
  );
}

export async function fetchCsForAgents(
  agentEmails: string[]
): Promise<Record<string, string[]>> {
  const emails = [...new Set(agentEmails.filter(Boolean))];
  if (emails.length === 0) return {};

  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("agent_email,cs_email")
    .in("agent_email", emails)
    .eq("is_assistant", true);
  if (error) return Object.fromEntries(emails.map((email) => [email, []]));

  return groupAssistantMembers(
    (data ?? []) as Array<{ agent_email: string; cs_email: string }>,
    emails
  );
}

// Agents this person is a promoted "Assistant" for — an Assistant gets the
// same rights as the agent owner on that agent's tasks.
//
// Throws rather than returning [] on a query failure, because both callers read
// an empty result as POSITIVE evidence that the actor is a plain CS and hand
// them the whole company queue (actorSeesAllTasks below, and the mirrored branch
// in fetchTasksForActor). Swallowing the error there turned a transient
// agent_members failure — a schema-cache miss, a per-statement timeout, an RLS
// change on that one table — into an assistant seeing every task in the company.
// Its sibling fetchSelectedAgentEmails already throws, so a full outage was
// always fail-closed; only a failure isolated to this table opened the hole.
export async function fetchAssistantAgentsForCs(email: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("agent_email")
    .eq("cs_email", email)
    .eq("is_assistant", true);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => (r as { agent_email: string }).agent_email))];
}

export type TaskQueueScope = {
  /** Agent emails whose tasks this worker may see through membership. */
  agentEmails: string[];
  /** Agent emails for which this worker is an assistant. */
  assistantAgentEmails: string[];
  /** Plain CS company-wide queue visibility. */
  seesAllTasks: boolean;
};

// Resolve the two membership facts that define a worker's task queue in one
// round trip to agent_members. The two public helpers above intentionally keep
// their historical error semantics for callers that only need one fact; queue
// authorization must use this fail-closed combined resolver instead.
export async function resolveTaskQueueScope(
  actor: TaskActor,
): Promise<TaskQueueScope> {
  if (actor.isManager || !actor.isWorker) {
    return { agentEmails: [], assistantAgentEmails: [], seesAllTasks: actor.isManager };
  }

  const [selectedAgentEmails, assistantAgentEmails] = await Promise.all([
    fetchSelectedAgentEmails(),
    fetchAssistantAgentsForCs(actor.email),
  ]);

  return {
    agentEmails: assistantAgentEmails,
    assistantAgentEmails,
    seesAllTasks:
      !selectedAgentEmails.has(actor.email) && assistantAgentEmails.length === 0,
  };
}

// The single check used everywhere "agent owner" rights are decided: either
// this actor literally IS the task's agent, or they're a registered
// Assistant for that agent. `agentEmail` is the task's `agent_email` column
// (nullable — a task with no agent has no owner/assistant to grant rights).
export async function isAgentOwnerOrAssistant(
  agentEmail: string | null,
  actorEmail: string
): Promise<boolean> {
  if (!agentEmail) return false;
  if (agentEmail === actorEmail) return true;
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("agent_email")
    .eq("agent_email", agentEmail)
    .eq("cs_email", actorEmail)
    .eq("is_assistant", true)
    .maybeSingle();
  return !error && Boolean(data);
}

export async function fetchAgentOwnerAndAssistantEmails(
  agentEmail: string | null
): Promise<string[]> {
  if (!agentEmail) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("cs_email")
    .eq("agent_email", agentEmail)
    .eq("is_assistant", true);
  if (error) return [agentEmail];

  return [
    ...new Set([
      agentEmail,
      ...(data ?? []).map((row) => (row as { cs_email: string }).cs_email),
    ]),
  ];
}

// All admin accounts — recipients for oversight notifications (e.g. an overdue
// resolved with a reason). Role lives on portal_account.
export async function fetchAdminEmails(): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email")
    .eq("role", "admin")
    .eq("is_active", true);
  if (error) return [];
  return [
    ...new Set((data ?? []).map((row) => (row as { email: string }).email)),
  ];
}

// A "see-all" task viewer: managers plus plain-CS (the company-wide queue).
// Agents (in task_agents) and Assistants stay scoped to their agent's tasks.
// Mirrors the plain-CS branch of fetchTasksForActor — keep the two in sync.
export async function actorSeesAllTasks(actor: TaskActor): Promise<boolean> {
  return (await resolveTaskQueueScope(actor)).seesAllTasks;
}

/**
 * Which Agents a person may create a task for, and what the New task form
 * starts on (user decision 2026-10-25). The API enforces the same scope:
 * a worker's task needs an Agent that is themselves or one they assist.
 *
 * - Manager: any Agent, starts empty ("Unassigned").
 * - Agent: starts on themselves; can also pick Agents they assist.
 * - Assistant of one Agent: starts on that Agent.
 * - Assistant of several: starts empty and must pick.
 * With a single choice the field is locked.
 */
export function newTaskAgentScope(input: {
  isManager: boolean;
  currentEmail: string;
  /** The Agent roster (task_agents). */
  agentEmails: readonly string[];
  /** Agents this person is an Assistant for. */
  assistedAgentEmails: readonly string[];
}): { agentEmails: string[]; defaultAgentEmail: string; locked: boolean } {
  if (input.isManager) {
    return { agentEmails: [...input.agentEmails], defaultAgentEmail: "", locked: false };
  }
  const isSelfAgent = input.agentEmails.includes(input.currentEmail);
  const agentEmails = [
    ...new Set([...(isSelfAgent ? [input.currentEmail] : []), ...input.assistedAgentEmails]),
  ];
  const defaultAgentEmail = isSelfAgent
    ? input.currentEmail
    : agentEmails.length === 1
      ? agentEmails[0]
      : "";
  return { agentEmails, defaultAgentEmail, locked: agentEmails.length === 1 };
}

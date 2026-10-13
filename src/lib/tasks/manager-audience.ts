function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Who among the task managers hears about one case (a task or an Enrollment
 * record) through the manager notifications: urgent backlog nobody picked up,
 * SLA and Due Date overdue, an overdue resolved with a reason, a new task or
 * record, key/QC stage moves, overdue and stale QC.
 *
 * - A manager who is not an Agent watches every case.
 * - A manager who is also an Agent (task_agents) only hears about the cases
 *   whose Agent is them, not every other Agent's.
 *
 * User decision 2026-10-13. Agents without task.manage are not managers and
 * never reach this list. Pure so it is unit tested; callers load the inputs.
 */
export function managerRecipientsForCase(input: {
  /** Every active account holding task.manage through an active role. */
  managerEmails: readonly string[];
  /** The Agent roster (task_agents). */
  agentEmails: Iterable<string>;
  /** The case's Agent (tasks.agent_email / enrollment_records.agent_email). */
  caseAgentEmail: string | null | undefined;
}): string[] {
  const agents = new Set([...input.agentEmails].map(normalize));
  const caseAgent = normalize(input.caseAgentEmail);
  return [
    ...new Set(
      input.managerEmails
        .map(normalize)
        .filter((email) => email !== "" && (!agents.has(email) || email === caseAgent))
    ),
  ];
}

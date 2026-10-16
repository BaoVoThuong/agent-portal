/**
 * One label per person on the task side, the highest that applies:
 *
 *   Admin (holds task.manage) > Agent > Assistant > Customer Service
 *
 * It is the same rule as the Task Board title a person sees for themselves
 * ("Admin Task Board", "Agent Task Board"…), so the label others see next to a
 * name always matches that person's own board. Someone without Tasks access has
 * no label. User decision 2026-10-14; it replaced the "Admin / Agent / Assistant
 * to X, else Customer Service" labels, which called managers and people with no
 * Tasks access "Customer Service".
 *
 * Pure: callers load the facts.
 */
export type TaskPositionKind = "admin" | "agent" | "assistant" | "cs";

export type TaskPositionFacts = {
  /** Holds task.manage (buildTaskActor().isManager). */
  isManager: boolean;
  /** Holds task.work or task.manage (buildTaskActor().isWorker). */
  isWorker: boolean;
  /** Listed in task_agents. */
  isAgent: boolean;
  /** Has any agent_members row with is_assistant. */
  isAssistant: boolean;
};

export function taskPositionKind(facts: TaskPositionFacts): TaskPositionKind | null {
  if (!facts.isWorker) return null;
  if (facts.isManager) return "admin";
  if (facts.isAgent) return "agent";
  if (facts.isAssistant) return "assistant";
  return "cs";
}

/** Display text. An Assistant's label names the Agents they assist. */
export function taskPositionLabel(
  kind: TaskPositionKind,
  assistantAgentNames: readonly string[] = [],
): string {
  if (kind === "admin") return "Admin";
  if (kind === "agent") return "Agent";
  if (kind === "cs") return "Customer Service";
  return assistantAgentNames.length > 0
    ? `Assistant to ${assistantAgentNames.join(", ")}`
    : "Assistant";
}

const TASK_BOARD_TITLES: Record<TaskPositionKind, string> = {
  admin: "Admin Task Board",
  agent: "Agent Task Board",
  assistant: "Assistant Task Board",
  cs: "Customer Service Task Board",
};

export function taskBoardTitle(kind: TaskPositionKind): string {
  return TASK_BOARD_TITLES[kind];
}

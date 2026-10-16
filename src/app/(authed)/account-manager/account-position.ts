import { buildTaskActor } from "@/lib/tasks/access";
import {
  taskPositionKind,
  taskPositionLabel,
  type TaskPositionKind,
} from "@/lib/tasks/positions";

/**
 * What the Accounts table shows about a person on the task side. Display
 * only: it never decides what anyone may do.
 */
export type AccountPosition = {
  kind: TaskPositionKind | null;
  /** The one label (positions.ts); null without Tasks access or when disabled. */
  label: string | null;
  warnings: string[];
};

export type AccountPositionFacts = {
  /** task_agents emails, lower-cased. */
  rosterEmails: ReadonlySet<string>;
  /** Lower-cased cs_email → agent emails of its is_assistant rows. */
  assistantAgentsByEmail: ReadonlyMap<string, readonly string[]>;
  /** Lower-cased email → display name. */
  nameByEmail: ReadonlyMap<string, string>;
};

export function resolveAccountPosition(
  account: {
    email: string;
    isActive: boolean;
    /** Keys of the account's role, or [] when that role is disabled. */
    rolePermissionKeys: readonly string[];
  },
  facts: AccountPositionFacts,
): AccountPosition {
  const email = account.email.trim().toLowerCase();
  const actor = buildTaskActor(account.isActive ? account.rolePermissionKeys : [], email);
  const assistantAgents = facts.assistantAgentsByEmail.get(email) ?? [];
  const nameOf = (agentEmail: string) => facts.nameByEmail.get(agentEmail) ?? agentEmail;

  const kind = taskPositionKind({
    isManager: actor.isManager,
    isWorker: actor.isWorker,
    isAgent: facts.rosterEmails.has(email),
    isAssistant: assistantAgents.length > 0,
  });

  return {
    kind,
    label: kind ? taskPositionLabel(kind, assistantAgents.map(nameOf)) : null,
    // A link to someone no longer in task_agents still scopes this person to
    // that email's tasks and keeps them out of the CS pool.
    warnings: account.isActive
      ? assistantAgents
          .filter((agentEmail) => !facts.rosterEmails.has(agentEmail))
          .map(
            (agentEmail) =>
              `Assistant to ${nameOf(agentEmail)}, who is no longer an Agent. Remove the link under Agent membership → Assistant membership.`,
          )
      : [],
  };
}

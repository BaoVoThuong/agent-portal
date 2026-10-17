import type { PositionKind } from "./positions";

/**
 * Position, the Agents an Assistant supports, and the direct manager of one
 * account, as Edit account shows them. update_account_atomic projects them
 * onto task_agents / agent_members, which still decide access.
 */
export type AccountConfig = {
  positionId: string | null;
  managerId: string | null;
  /** Lower-cased Agent emails; only an Assistant-group Position has any. */
  assistedAgentEmails: string[];
};

/** Keys for update_account_atomic's p_patch. Empty when nothing changed. */
export type AccountConfigPatch = {
  position_id?: string | null;
  manager_id?: string | null;
  assisted_agent_emails?: string[];
  expected?: { position_id: string | null; manager_id: string | null; assisted_agent_emails: string[] };
};

function normalizeEmails(emails: readonly string[]): string[] {
  return [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))].sort();
}

function sameEmails(a: readonly string[], b: readonly string[]): boolean {
  const left = normalizeEmails(a);
  const right = normalizeEmails(b);
  return left.length === right.length && left.every((email, index) => email === right[index]);
}

/**
 * Only what changed, plus the values the form loaded (`expected`) so the
 * database refuses to overwrite someone else's edit made in between.
 */
export function buildAccountConfigPatch(
  current: AccountConfig,
  next: AccountConfig,
  kindOf: (positionId: string | null) => PositionKind | null,
): AccountConfigPatch {
  const patch: AccountConfigPatch = {};
  const positionChanged = current.positionId !== next.positionId;
  if (positionChanged) patch.position_id = next.positionId;
  if (current.managerId !== next.managerId) patch.manager_id = next.managerId;
  if (
    kindOf(next.positionId) === "assistant" &&
    (positionChanged || !sameEmails(current.assistedAgentEmails, next.assistedAgentEmails))
  ) {
    patch.assisted_agent_emails = normalizeEmails(next.assistedAgentEmails);
  }
  if (Object.keys(patch).length > 0) {
    patch.expected = {
      position_id: current.positionId,
      manager_id: current.managerId,
      assisted_agent_emails: normalizeEmails(current.assistedAgentEmails),
    };
  }
  return patch;
}

/** Blocks Save with a reason, or null. */
export function accountConfigProblem(
  next: AccountConfig,
  kindOf: (positionId: string | null) => PositionKind | null,
): string | null {
  if (kindOf(next.positionId) === "assistant" && normalizeEmails(next.assistedAgentEmails).length === 0) {
    return "Choose at least one Agent this Assistant supports.";
  }
  return null;
}

/** Task access from the account's role (task.manage includes task.work). */
export type TaskAccess = "manage" | "work" | "none";

/**
 * The Task Board scope a person gets (lib/tasks/membership.ts): managers see
 * everything; an Agent or Assistant without task.manage sees their own and
 * their Agents' work; any other worker is plain CS and sees the company queue.
 */
type TaskScope = "all" | "own" | "assisted" | "company" | null;

function taskScope(access: TaskAccess, kind: PositionKind | null): TaskScope {
  if (access === "none") return null;
  if (access === "manage") return "all";
  if (kind === "agent") return "own";
  if (kind === "assistant") return "assisted";
  return "company";
}

const SCOPE_TEXT: Record<Exclude<TaskScope, null>, string> = {
  all: "every task",
  own: "only their own tasks and enrollments",
  assisted: "only their Agents' tasks and enrollments",
  company: "the whole company task queue",
};

/**
 * What a save does to who sees what and who is notified, so Edit account can
 * say it before Save. Agent and Assistant positions write task_agents /
 * agent_members, which decide Task, Lead and Enrollment scope, the CS
 * auto-assign pool and some notifications. Other positions and the manager
 * change nothing.
 */
export function accountConfigEffects(input: {
  personName: string;
  current: AccountConfig;
  next: AccountConfig;
  kindOf: (positionId: string | null) => PositionKind | null;
  /** Names of the Assistants who support this person today (when an Agent). */
  assistantNames: readonly string[];
  nameOfEmail: (email: string) => string;
  /** This person's Task access and CS pool standing; omit to skip those lines. */
  access?: { taskAccess: TaskAccess; csPoolBase: boolean };
}): string[] {
  const { personName, current, next, kindOf, assistantNames, nameOfEmail, access } = input;
  const before = kindOf(current.positionId);
  const after = kindOf(next.positionId);
  const effects: string[] = [];

  if (before === "agent" && after !== "agent") {
    effects.push(
      assistantNames.length > 0
        ? `${personName} leaves the Agent list. ${assistantNames.join(", ")} will no longer assist them and lose access to their tasks, leads and enrollments.`
        : `${personName} leaves the Agent list.`,
    );
  }
  if (before === "assistant" && after !== "assistant" && current.assistedAgentEmails.length > 0) {
    effects.push(
      `${personName} stops assisting ${normalizeEmails(current.assistedAgentEmails).map(nameOfEmail).join(", ")}.`,
    );
  }
  if (after === "agent" && before !== "agent") {
    effects.push(`${personName} joins the Agent list.`);
  }
  if (after === "assistant") {
    const was = before === "assistant" ? normalizeEmails(current.assistedAgentEmails) : [];
    const now = normalizeEmails(next.assistedAgentEmails);
    const added = now.filter((email) => !was.includes(email));
    const removed = was.filter((email) => !now.includes(email));
    if (added.length > 0) effects.push(`${personName} starts assisting ${added.map(nameOfEmail).join(", ")}.`);
    if (removed.length > 0) effects.push(`${personName} stops assisting ${removed.map(nameOfEmail).join(", ")}.`);
  }

  if (access && before !== after) {
    const scopeBefore = taskScope(access.taskAccess, before);
    const scopeAfter = taskScope(access.taskAccess, after);
    if (scopeBefore && scopeAfter && scopeBefore !== scopeAfter) {
      effects.push(`${personName} will see ${SCOPE_TEXT[scopeAfter]} instead of ${SCOPE_TEXT[scopeBefore]}.`);
    }
    // assign_unassigned_task: Agents and Assistants are never in the CS pool.
    const membership = (kind: PositionKind | null) => kind === "agent" || kind === "assistant";
    const poolBefore = access.csPoolBase && !membership(before);
    const poolAfter = access.csPoolBase && !membership(after);
    if (poolBefore !== poolAfter) {
      effects.push(
        poolAfter
          ? `${personName} starts receiving auto-assigned CS tasks.`
          : `${personName} stops receiving auto-assigned CS tasks.`,
      );
    }
    // managerRecipientsForCase: a manager who is an Agent hears only about their own cases.
    if (access.taskAccess === "manage" && (before === "agent") !== (after === "agent")) {
      effects.push(
        after === "agent"
          ? `${personName} will get manager notifications only for their own cases.`
          : `${personName} will get manager notifications for every case again.`,
      );
    }
  }
  return effects;
}

/**
 * The old Agent membership tab offered only Task workers as Assistants
 * (fetchTaskAssignees). Agents could be anyone.
 */
export function canBeAssistant(access: TaskAccess): boolean {
  return access !== "none";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ASSISTED_AGENTS = 100;

function parseOptionalId(value: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value === "string" && UUID.test(value)) return { ok: true, value };
  return { ok: false, error: `Invalid ${label}.` };
}

function parseEmailList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ASSISTED_AGENTS) return null;
  if (!value.every((item) => typeof item === "string")) return null;
  return normalizeEmails(value as string[]);
}

/** Server side: the request body's config keys → p_patch keys. */
export function parseAccountConfigRequest(body: {
  positionId?: unknown;
  managerId?: unknown;
  assistedAgentEmails?: unknown;
  expected?: unknown;
}): { ok: true; patch: AccountConfigPatch } | { ok: false; error: string } {
  const patch: AccountConfigPatch = {};

  if (body.positionId !== undefined) {
    const parsed = parseOptionalId(body.positionId, "position");
    if (!parsed.ok) return parsed;
    patch.position_id = parsed.value;
  }
  if (body.managerId !== undefined) {
    const parsed = parseOptionalId(body.managerId, "manager");
    if (!parsed.ok) return parsed;
    patch.manager_id = parsed.value;
  }
  if (body.assistedAgentEmails !== undefined) {
    const emails = parseEmailList(body.assistedAgentEmails);
    if (!emails) return { ok: false, error: "Invalid list of Agents." };
    patch.assisted_agent_emails = emails;
  }
  if (body.expected !== undefined) {
    const expected = (body.expected ?? {}) as Record<string, unknown>;
    const position = parseOptionalId(expected.position_id ?? null, "position");
    const manager = parseOptionalId(expected.manager_id ?? null, "manager");
    const emails = parseEmailList(expected.assisted_agent_emails ?? []);
    if (!position.ok || !manager.ok || !emails) {
      return { ok: false, error: "Invalid account snapshot. Reload the page and try again." };
    }
    patch.expected = {
      position_id: position.value,
      manager_id: manager.value,
      assisted_agent_emails: emails,
    };
  }
  return { ok: true, patch };
}

/** Keys that rewrite Agent / Assistant membership (task_agents, agent_members). */
export function changesMembership(patch: AccountConfigPatch): boolean {
  return "position_id" in patch || "assisted_agent_emails" in patch;
}

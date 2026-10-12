import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import type { LeadRow } from "./types";

export type LeadActor = {
  email: string;
  isManager: boolean;
  isWorker: boolean;
};

/**
 * Extra ways a worker reaches one lead. Resolved once per request against
 * agent_members (see lib/leads/membership.ts) and passed in, so every check
 * below stays pure and unit-testable.
 */
export type LeadMembershipFlags = {
  /** Actor is the assigned agent, or a promoted Assistant for that agent. */
  isOwnerOrAssistant?: boolean;
  /** Actor is explicitly listed in leads.collaborator_emails. */
  isCollaborator?: boolean;
};

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Lead access comes from the Lead permissions only. lead.manage is the whole
 * manager role and already includes lead.work. Until 2026-10-09 an account
 * named admin was a manager without lead.manage, and task.manage could see
 * every lead; both were cross-grants the Role Manager never showed.
 */
export function buildLeadActor(
  permissions: readonly string[] | undefined,
  email: string
): LeadActor {
  const isManager = can(permissions, PERMISSIONS.LEAD_MANAGE);
  return {
    email,
    isManager,
    isWorker: isManager || can(permissions, PERMISSIONS.LEAD_WORK),
  };
}

export function canManageLeads(actor: LeadActor): boolean {
  return actor.isManager;
}

export function canWorkLeads(actor: LeadActor): boolean {
  return actor.isWorker;
}

/**
 * Agents a worker may open a Personal lead for: themselves when they are an
 * Agent in Account Management, then every Agent they are an Assistant for.
 *
 * Both sides are cut down to the roster. An Assistant pairing can outlive the
 * agent's roster entry, and a Personal lead has to land on a current Agent —
 * the same rule the create route enforces for a manager's pick.
 *
 * Empty means the worker is neither an Agent nor an Assistant, so they cannot
 * add a lead at all. Managers do not use this: they may choose any roster Agent.
 */
export function personalLeadAgentEmailsForWorker(input: {
  actorEmail: string;
  rosterEmails: Iterable<string>;
  assistedAgentEmails: readonly string[];
}): string[] {
  const roster = new Set([...input.rosterEmails].map(normalize));
  const own = normalize(input.actorEmail);
  const candidates = [own, ...input.assistedAgentEmails.map(normalize)];
  return [...new Set(candidates.filter((email) => email !== "" && roster.has(email)))];
}

/** True when the actor's own email is the one the lead is assigned to. */
export function isLeadOwner(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">
): boolean {
  const owner = normalize(lead.assigned_to_email);
  return owner !== "" && owner === normalize(actor.email);
}

/**
 * Managers see the whole queue. A worker sees a lead they are assigned, and any
 * lead assigned to an agent they are an Assistant for — the same
 * agent/assistant pairing the task board uses, read from agent_members.
 */
export function canViewLead(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email" | "collaborator_emails">,
  flags: LeadMembershipFlags = {}
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isLeadOwner(actor, lead) || Boolean(flags.isOwnerOrAssistant) ||
    Boolean(flags.isCollaborator) ||
    (lead.collaborator_emails ?? []).some((email) => normalize(email) === normalize(actor.email));
}

/**
 * Editing a lead's data in place. Deliberately its own rule rather than reusing
 * canViewLead: if workers are ever allowed to browse the unassigned pool, that
 * must not silently become permission to edit it.
 */
export function canEditLead(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email" | "collaborator_emails">,
  flags: LeadMembershipFlags = {}
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isLeadOwner(actor, lead) || Boolean(flags.isOwnerOrAssistant) ||
    Boolean(flags.isCollaborator) ||
    (lead.collaborator_emails ?? []).some((email) => normalize(email) === normalize(actor.email));
}

/**
 * Logging an interaction. Same reach as editing: a manager on any lead, a
 * worker on their own and on their agent's.
 *
 * This used to exclude a manager who was not the assigned agent, on the grounds
 * that contact_attempt_count and last_contacted_at are read as that agent's
 * record. The counters are per-LEAD, not per-person — they answer "has anyone
 * called this person yet", which is what the alert engine needs — and every
 * interaction row stores actor_email, so who actually made the call is never
 * lost. A manager covering for an agent on leave is ordinary work, and refusing
 * it just pushed that call outside the system entirely.
 *
 * Kept separate from canEditLead even though the two currently agree: logging a
 * conversation and correcting a field are different acts, and the RPC enforces
 * rules on logging that editing does not.
 */
export function canLogInteraction(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email" | "collaborator_emails">,
  flags: LeadMembershipFlags = {}
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isLeadOwner(actor, lead) || Boolean(flags.isOwnerOrAssistant) ||
    Boolean(flags.isCollaborator) ||
    (lead.collaborator_emails ?? []).some((email) => normalize(email) === normalize(actor.email));
}

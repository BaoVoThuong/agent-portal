import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  LEGACY_SUPER_ADMIN_ROLE_NAME,
  SYSTEM_ROLE_NAMES,
} from "@/lib/rbac/system-roles";
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
};

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/** Account-role admin: the legacy `admin` role or a super-admin RBAC role. */
export function isLeadViewAdmin(user: {
  role?: string | null;
  roles?: readonly string[];
}): boolean {
  const roles = user.roles ?? [];
  return (
    user.role === "admin" ||
    roles.includes(SYSTEM_ROLE_NAMES.SUPER_ADMIN) ||
    roles.includes(LEGACY_SUPER_ADMIN_ROLE_NAME)
  );
}

export function buildLeadActor(
  permissions: readonly string[] | undefined,
  email: string,
  opts?: { isAdmin?: boolean }
): LeadActor {
  // An account-role admin manages leads without needing lead.manage granted
  // separately. The route gate still requires one of the lead permissions, so
  // this widens what an admin can do once inside, not who gets in.
  const isManager =
    can(permissions, PERMISSIONS.LEAD_MANAGE) || Boolean(opts?.isAdmin);
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

/** True when the actor's own email is the one the lead is assigned to. */
export function isLeadOwner(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">
): boolean {
  const owner = normalize(lead.assigned_to_email);
  return owner !== "" && owner === normalize(actor.email);
}

/**
 * Managers and account admins see the whole queue. A worker sees a lead they
 * are assigned, and any lead assigned to an agent they are an Assistant for —
 * the same agent/assistant pairing the task board uses, read from agent_members.
 */
export function canViewLead(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">,
  flags: LeadMembershipFlags = {}
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isLeadOwner(actor, lead) || Boolean(flags.isOwnerOrAssistant);
}

/**
 * Editing a lead's data in place. Deliberately its own rule rather than reusing
 * canViewLead: if workers are ever allowed to browse the unassigned pool, that
 * must not silently become permission to edit it.
 */
export function canEditLead(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">,
  flags: LeadMembershipFlags = {}
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isLeadOwner(actor, lead) || Boolean(flags.isOwnerOrAssistant);
}

/**
 * Logging an interaction. Restricted to the people actually working the lead —
 * its assigned agent and that agent's Assistants — including a manager only
 * when the lead is assigned to them. A manager logging a call on someone
 * else's lead would credit the wrong person's contact count.
 */
export function canLogInteraction(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">,
  flags: LeadMembershipFlags = {}
): boolean {
  if (!actor.isWorker) return false;
  return isLeadOwner(actor, lead) || Boolean(flags.isOwnerOrAssistant);
}

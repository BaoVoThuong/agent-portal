import {
  canEditLead,
  canLogInteraction,
  canManageLeads,
  canViewLead,
  type LeadActor,
  type LeadMembershipFlags,
} from "./access";
import type { LeadRow } from "./types";

export type LeadCapabilities = {
  canView: boolean;
  canEdit: boolean;
  canLog: boolean;
  canAssign: boolean;
};

/**
 * One source of truth: routes and the client call this with the same resolved
 * flags, so the two layers cannot drift. The task board does the same through
 * resolveTaskCapabilities; the lead table used to carry its own hand-written
 * copy of the rule, which is how this module has drifted before.
 */
export function resolveLeadCapabilities(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">,
  flags: LeadMembershipFlags = {}
): LeadCapabilities {
  return {
    canView: canViewLead(actor, lead, flags),
    canEdit: canEditLead(actor, lead, flags),
    canLog: canLogInteraction(actor, lead, flags),
    canAssign: canManageLeads(actor),
  };
}

/**
 * The client holds a resolved owner list rather than an actor: the server works
 * out "your own email plus the agents you assist" once per request and hands
 * the answer down. null means a manager, i.e. every lead.
 *
 * Kept beside resolveLeadCapabilities on purpose — the two must agree, and a
 * test in capabilities.test.ts asserts they do.
 */
export function leadIsInScope(
  lead: Pick<LeadRow, "assigned_to_email">,
  ownerEmails: readonly string[] | null
): boolean {
  if (ownerEmails === null) return true;
  const owner = lead.assigned_to_email?.trim().toLowerCase() ?? "";
  return owner !== "" && ownerEmails.includes(owner);
}

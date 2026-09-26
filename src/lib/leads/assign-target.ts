import { canWorkLeads, leadActorFromGrants } from "./access";

/** Người nhận lead: account + grant hiệu lực (grantsForAccess). */
export type LeadAssignTarget = {
  isActive: boolean;
  grants: readonly string[];
};

/**
 * Who may receive a lead: an active account that works leads. Reads the same
 * grant as every lead route, so an account-role admin (who manages leads
 * through the compatibility grant) can also be handed one.
 */
export function canBeAssignedLead(target: LeadAssignTarget): boolean {
  if (!target.isActive) return false;
  return canWorkLeads(leadActorFromGrants("", target.grants));
}

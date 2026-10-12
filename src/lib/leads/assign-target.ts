import { buildLeadActor } from "./access";

/** The parts of UserAccess that decide whether a lead may be handed over. */
export type LeadAssignTarget = {
  isActive: boolean;
  permissions: readonly string[];
};

/**
 * Who may receive a lead: an active account that works leads, read exactly the
 * way buildLeadActor reads it everywhere else so the assign routes can never
 * disagree with the lead pages about who counts.
 */
export function canBeAssignedLead(target: LeadAssignTarget): boolean {
  if (!target.isActive) return false;
  return buildLeadActor(target.permissions, "").isWorker;
}

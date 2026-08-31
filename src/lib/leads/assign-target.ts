import { buildLeadActor, isLeadViewAdmin } from "./access";

/** The parts of UserAccess that decide whether a lead may be handed over. */
export type LeadAssignTarget = {
  isActive: boolean;
  permissions: readonly string[];
  /** portal_account.role, flattened by getUserAccessByEmail. */
  legacyRole: string;
  roles: readonly string[];
};

/**
 * Who may receive a lead. Reads the admin flag exactly the way buildLeadActor
 * does everywhere else: without it an account-role admin could manage leads but
 * could not be assigned one, which is the state this function was written to
 * fix.
 */
export function canBeAssignedLead(target: LeadAssignTarget): boolean {
  if (!target.isActive) return false;
  const actor = buildLeadActor(target.permissions, "", {
    isAdmin: isLeadViewAdmin({ role: target.legacyRole, roles: target.roles }),
  });
  return actor.isWorker;
}

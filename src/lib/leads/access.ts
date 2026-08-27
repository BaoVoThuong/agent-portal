import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import type { LeadRow } from "./types";

export type LeadActor = {
  email: string;
  isManager: boolean;
  isWorker: boolean;
};

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

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

/** Managers see the queue; workers see only leads currently assigned to them. */
export function canViewLead(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  const owner = normalize(lead.assigned_to_email);
  return owner !== "" && owner === normalize(actor.email);
}

/** Logging an interaction is restricted to the current owner, including managers. */
export function canLogInteraction(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">
): boolean {
  if (!actor.isWorker) return false;
  const owner = normalize(lead.assigned_to_email);
  return owner !== "" && owner === normalize(actor.email);
}

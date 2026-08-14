import type { AcaOverviewActionRow } from "./aca-overview-types";

export function applyResponsibleAssignment(rows: readonly AcaOverviewActionRow[], recordId: string, email: string | null): AcaOverviewActionRow[] {
  return rows.map((row) => row.recordId === recordId ? { ...row, responsibleEmail: email } : row);
}
/**
 * Adopts the timestamp the PATCH returned. Without it a second edit of the same
 * row sends a stale `expected_updated_at` and 409s, which reads to the user as
 * "it worked once and then stopped working".
 */
export function reconcileAssignedRow(rows: readonly AcaOverviewActionRow[], recordId: string, updatedAt: string | undefined): AcaOverviewActionRow[] {
  if (!updatedAt) return [...rows];
  return rows.map((row) => row.recordId === recordId ? { ...row, updatedAt } : row);
}

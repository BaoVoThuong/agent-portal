import type { AcaOverviewActionRow } from "./aca-overview-types";

export function applyResponsibleAssignment(rows: readonly AcaOverviewActionRow[], recordId: string, email: string | null): AcaOverviewActionRow[] {
  return rows.map((row) => row.recordId === recordId ? { ...row, responsibleEmail: email } : row);
}
export function revertResponsibleAssignment(rows: readonly AcaOverviewActionRow[], recordId: string, previousEmail: string | null): AcaOverviewActionRow[] {
  return applyResponsibleAssignment(rows, recordId, previousEmail);
}

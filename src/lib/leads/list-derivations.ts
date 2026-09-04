import { resolveLeadAlerts, type LeadAlert } from "./alerts";
import {
  classifyLeadHealth,
  emptyLeadHealthCounts,
  type LeadHealth,
} from "./health";
import { settingsForLead, type LeadAlertSettingsByProduct } from "./overview";
import { buildStatusById } from "./status-lookup";
import type { LeadInteractionType, LeadRow, LeadStatus } from "./types";
import type { TableColumnOption } from "@/lib/table-config/types";

/**
 * Pure derivations for the lead list. They live here rather than in
 * `LeadsClient` / `LeadTable` for two reasons: vitest runs with
 * `environment: "node"` so a `.tsx` file cannot be unit-tested, and — the point
 * of this module — the components were rebuilding all of these on every render,
 * including every keystroke in the search box. Wrapping the calls in `useMemo`
 * there only pays off if the work itself sits in one stable place.
 */

export type LeadLookups = {
  /**
   * Active + archived: an archived status still labels an old row, and
   * `resolveLeadAlerts` must see the real `kind` or it treats a closed lead as
   * still open (a red flag that never clears). Same reasoning as the old inline
   * `buildStatusById(statuses, archivedStatuses)` in LeadsClient.
   */
  statusById: Map<string, LeadStatus>;
  /** Active only — feeds the sort's status-label comparator and the Status
   *  filter dropdown, neither of which should offer an archived status. */
  statusNameById: Map<string, string>;
  interactionTypeById: Map<string, LeadInteractionType>;
  optionsByColumn: Map<string, TableColumnOption[]>;
};

export function buildLeadLookups(
  statuses: LeadStatus[],
  archivedStatuses: LeadStatus[],
  interactionTypes: LeadInteractionType[],
  columnOptions: TableColumnOption[],
): LeadLookups {
  const statusById = buildStatusById(statuses, archivedStatuses);
  const statusNameById = new Map(statuses.map((s) => [s.id, s.label]));
  const interactionTypeById = new Map(interactionTypes.map((t) => [t.id, t]));
  const optionsByColumn = new Map<string, TableColumnOption[]>();
  for (const option of columnOptions) {
    optionsByColumn.set(option.column_id, [
      ...(optionsByColumn.get(option.column_id) ?? []),
      option,
    ]);
  }
  return { statusById, statusNameById, interactionTypeById, optionsByColumn };
}

export type LeadBadges = {
  alertsByLeadId: Map<string, LeadAlert[]>;
  healthByLeadId: Map<string, LeadHealth>;
  healthCounts: Record<LeadHealth, number>;
};

/**
 * Alerts + health bucket per lead. Depends only on the rows and the thresholds
 * — NOT on the active filters — so `LeadsClient` can memoise this on `[leads,
 * lookups, alertSettings]` and keep it off the search-keystroke path. The `now`
 * argument inside `resolveLeadAlerts` / `classifyLeadHealth` still defaults to
 * render time, so badges stay live as the clock moves.
 */
export function buildLeadBadges(
  leads: readonly LeadRow[],
  lookups: Pick<LeadLookups, "statusById">,
  alertSettings: LeadAlertSettingsByProduct,
): LeadBadges {
  const alertsByLeadId = new Map<string, LeadAlert[]>();
  const healthByLeadId = new Map<string, LeadHealth>();
  const healthCounts = emptyLeadHealthCounts();
  for (const lead of leads) {
    const status = lead.status_id
      ? lookups.statusById.get(lead.status_id) ?? null
      : null;
    const forLead = settingsForLead(alertSettings, lead);
    alertsByLeadId.set(lead.id, resolveLeadAlerts(lead, status, forLead));
    const bucket = classifyLeadHealth(lead, status, forLead);
    healthByLeadId.set(lead.id, bucket);
    healthCounts[bucket] += 1;
  }
  return { alertsByLeadId, healthByLeadId, healthCounts };
}

/**
 * Distinct, trimmed, locale-sorted event names carried by the loaded rows.
 * Event is free text on the row, so the filter's choices are whatever the data
 * holds rather than a lookup table.
 */
export function collectEventNames(leads: readonly LeadRow[]): string[] {
  return [
    ...new Set(
      leads
        .map((lead) => lead.event_name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

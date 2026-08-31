import type { LeadRow } from "./types";

export type LeadFilters = {
  /** Free text over name, phone and email. */
  search: string;
  assignedTo: string | null;
  statusId: string | null;
  eventId: string | null;
  product: "pc" | "health" | null;
};

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  search: "",
  assignedTo: null,
  statusId: null,
  eventId: null,
  product: null,
};

/**
 * Digits only, so a search for "714-555" finds a lead stored as "7145550123".
 * Phone numbers are the one field people paste in whatever shape their source
 * used, and the stored value is already normalised to digits.
 */
function digits(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * Matches name, email and phone. Unassigned rows are matched by the literal
 * word "unassigned" so a manager can find the pool by typing what they see.
 */
export function matchesLeadSearch(lead: LeadRow, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  if (lead.full_name?.toLowerCase().includes(query)) return true;
  if (lead.email?.toLowerCase().includes(query)) return true;
  if (!lead.assigned_to_email && "unassigned".includes(query)) return true;

  const queryDigits = digits(query);
  if (queryDigits.length >= 3 && lead.phone) {
    if (digits(lead.phone).includes(queryDigits)) return true;
  }
  return false;
}

export function filterLeads(
  leads: readonly LeadRow[],
  filters: LeadFilters
): LeadRow[] {
  return leads.filter((lead) => {
    if (filters.product && lead.product !== filters.product) return false;
    if (filters.statusId && lead.status_id !== filters.statusId) return false;
    if (filters.eventId && lead.event_id !== filters.eventId) return false;
    // Compare against null, not truthiness: "" is the sentinel for "in the
    // pool", which is a real thing to filter for and cannot be expressed by an
    // email. A truthy check silently drops that choice.
    if (filters.assignedTo !== null) {
      const owner = lead.assigned_to_email?.trim().toLowerCase() ?? "";
      if (owner !== filters.assignedTo.trim().toLowerCase()) return false;
    }
    return matchesLeadSearch(lead, filters.search);
  });
}

export function activeLeadFilterCount(filters: LeadFilters): number {
  return (
    (filters.search.trim() ? 1 : 0) +
    (filters.assignedTo === null ? 0 : 1) +
    (filters.statusId ? 1 : 0) +
    (filters.eventId ? 1 : 0) +
    (filters.product ? 1 : 0)
  );
}

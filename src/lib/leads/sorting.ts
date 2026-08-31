import type { LeadRow } from "./types";

/** Column keys the list can sort by. Anything else falls back to the default. */
export const LEAD_SORT_KEYS = [
  "key",
  "name",
  "product",
  "phone",
  "email",
  "assignee",
  "status",
  "attempts",
  "lastContact",
  "followUp",
  "event",
  "createdAt",
] as const;
export type LeadSortKey = (typeof LEAD_SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export function isLeadSortKey(value: unknown): value is LeadSortKey {
  return (
    typeof value === "string" &&
    (LEAD_SORT_KEYS as readonly string[]).includes(value)
  );
}

export type LeadSortContext = {
  statusLabel: (id: string | null) => string | null;
  personLabel: (email: string) => string;
};

function timeValue(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A comparable value, or null to sort last. */
function sortValue(
  lead: LeadRow,
  key: LeadSortKey,
  context: LeadSortContext
): string | number | null {
  switch (key) {
    case "key": return lead.display_number;
    // Case-insensitive so "anh" and "Anh" do not split into two runs.
    case "name": return lead.full_name?.trim().toLowerCase() || null;
    case "product": return lead.product;
    case "phone": return lead.phone || null;
    case "email": return lead.email?.trim().toLowerCase() || null;
    case "assignee":
      return lead.assigned_to_email
        ? context.personLabel(lead.assigned_to_email).toLowerCase()
        : null;
    case "status": return context.statusLabel(lead.status_id)?.toLowerCase() ?? null;
    case "attempts": return lead.contact_attempt_count;
    case "lastContact": return timeValue(lead.last_contacted_at);
    case "followUp": return timeValue(lead.next_follow_up_at);
    case "event": return lead.event_name?.trim().toLowerCase() || null;
    case "createdAt": return timeValue(lead.created_at);
  }
}

/**
 * Nulls sort last in BOTH directions, matching sortTasks. Flipping them to the
 * top on a descending sort would bury the rows someone is looking for under a
 * block of blanks — the reason to sort by Last contact is to find the leads
 * that have one.
 */
export function sortLeads(
  leads: readonly LeadRow[],
  key: LeadSortKey,
  dir: SortDir,
  context: LeadSortContext
): LeadRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...leads].sort((a, b) => {
    const av = sortValue(a, key, context);
    const bv = sortValue(b, key, context);
    if (av === null && bv === null) return a.display_number - b.display_number;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    // Stable tail-break so equal values never reshuffle between renders.
    return a.display_number - b.display_number;
  });
}

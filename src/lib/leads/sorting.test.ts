import { describe, expect, it } from "vitest";
import { isLeadSortKey, sortLeads, type LeadSortContext } from "./sorting";
import type { LeadRow } from "./types";

const context: LeadSortContext = {
  statusLabel: (id) => (id ? { s1: "New", s2: "Working" }[id] ?? null : null),
  personLabel: (email) => email.split("@")[0],
};

function lead(patch: Partial<LeadRow>): LeadRow {
  return {
    id: Math.random().toString(36), display_number: 1, product: "health", products: ["health"],
    event_id: null, full_name: null, phone: "1", email: null,
    assigned_to_email: null, assigned_at: null, assigned_by_email: null,
    status_id: null, first_contacted_at: null, last_contacted_at: null,
    contact_attempt_count: 0, next_follow_up_at: null, closed_at: null,
    created_by_email: "m@x.com", created_at: "2026-08-01T00:00:00Z",
    updated_by_email: null, updated_at: "2026-08-01T00:00:00Z",
    custom_values: {}, archived_at: null, ...patch,
  };
}

const names = (rows: LeadRow[]) => rows.map((row) => row.full_name);

describe("sortLeads", () => {
  it("sorts names case-insensitively", () => {
    const rows = [lead({ full_name: "banana", display_number: 1 }),
                  lead({ full_name: "Apple", display_number: 2 })];
    expect(names(sortLeads(rows, "name", "asc", context))).toEqual(["Apple", "banana"]);
    expect(names(sortLeads(rows, "name", "desc", context))).toEqual(["banana", "Apple"]);
  });

  // Flipping blanks to the top on a descending sort would bury the rows someone
  // is looking for: you sort by Last contact to find the leads that have one.
  it("keeps blanks last in both directions", () => {
    const rows = [
      lead({ full_name: "no contact", last_contacted_at: null, display_number: 1 }),
      lead({ full_name: "older", last_contacted_at: "2026-08-01T00:00:00Z", display_number: 2 }),
      lead({ full_name: "newer", last_contacted_at: "2026-08-10T00:00:00Z", display_number: 3 }),
    ];
    expect(names(sortLeads(rows, "lastContact", "asc", context))).toEqual(["older", "newer", "no contact"]);
    expect(names(sortLeads(rows, "lastContact", "desc", context))).toEqual(["newer", "older", "no contact"]);
  });

  it("sorts by the resolved label, not the raw id", () => {
    const rows = [lead({ full_name: "z", event_name: "Zebra Fair", display_number: 1 }),
                  lead({ full_name: "a", event_name: "Apple Expo", display_number: 2 })];
    // e1 is "Zebra Fair", e2 is "Apple Expo" — id order would be the reverse.
    expect(names(sortLeads(rows, "event", "asc", context))).toEqual(["a", "z"]);
  });

  it("sorts attempts numerically, not as text", () => {
    const rows = [lead({ full_name: "nine", contact_attempt_count: 9, display_number: 1 }),
                  lead({ full_name: "ten", contact_attempt_count: 10, display_number: 2 })];
    expect(names(sortLeads(rows, "attempts", "asc", context))).toEqual(["nine", "ten"]);
  });

  // Without a tie-break, equal values reshuffle between renders and rows appear
  // to jump while someone is reading them.
  it("breaks ties stably by lead number", () => {
    const rows = [lead({ full_name: "same", display_number: 3 }),
                  lead({ full_name: "same", display_number: 1 }),
                  lead({ full_name: "same", display_number: 2 })];
    expect(sortLeads(rows, "name", "asc", context).map((r) => r.display_number)).toEqual([1, 2, 3]);
    expect(sortLeads(rows, "name", "desc", context).map((r) => r.display_number)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input", () => {
    const rows = [lead({ full_name: "b", display_number: 1 }), lead({ full_name: "a", display_number: 2 })];
    sortLeads(rows, "name", "asc", context);
    expect(names(rows)).toEqual(["b", "a"]);
  });

  it("recognises only real sort keys", () => {
    expect(isLeadSortKey("name")).toBe(true);
    expect(isLeadSortKey("secondary_phone")).toBe(false);
    expect(isLeadSortKey(null)).toBe(false);
  });
});

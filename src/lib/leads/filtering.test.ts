import type { LeadHealth } from "./health";
import { describe, expect, it } from "vitest";
import { EMPTY_LEAD_FILTERS, activeLeadFilterCount, filterLeads, matchesLeadSearch } from "./filtering";
import type { LeadRow } from "./types";

function lead(patch: Partial<LeadRow>): LeadRow {
  return {
    id: Math.random().toString(36), display_number: 1,
    event_id: null, full_name: "Anh Nguyen", phone: "7145550123",
    email: "anh@example.com", fub_link: null, assigned_to_email: "cs@x.com", assigned_at: null,
    assigned_by_email: null, status_id: null, first_contacted_at: null,
    last_contacted_at: null, contact_attempt_count: 0, next_follow_up_at: null,
    closed_at: null, created_by_email: "m@x.com", created_at: "2026-08-01T00:00:00Z",
    updated_by_email: null, updated_at: "2026-08-01T00:00:00Z",
    custom_values: {}, archived_at: null, ...patch,
  };
}

describe("matchesLeadSearch", () => {
  it("matches part of a name, case-insensitively", () => {
    expect(matchesLeadSearch(lead({}), "nguy")).toBe(true);
    expect(matchesLeadSearch(lead({}), "NGUY")).toBe(true);
    expect(matchesLeadSearch(lead({}), "smith")).toBe(false);
  });

  it("matches an email fragment", () => {
    expect(matchesLeadSearch(lead({}), "example.com")).toBe(true);
  });

  // People paste a number in whatever shape their source used; the stored value
  // is already digits only, so compare digits to digits.
  it("matches a phone however it is punctuated", () => {
    expect(matchesLeadSearch(lead({}), "714-555")).toBe(true);
    expect(matchesLeadSearch(lead({}), "(714) 555 0123")).toBe(true);
    expect(matchesLeadSearch(lead({}), "5550123")).toBe(true);
  });

  // Two digits would match almost every number and make the box feel broken.
  it("ignores a digit fragment too short to mean anything", () => {
    expect(matchesLeadSearch(lead({ full_name: "Zed" }), "71")).toBe(false);
  });

  it("finds the pool by the word shown on screen", () => {
    expect(matchesLeadSearch(lead({ assigned_to_email: null }), "unassigned")).toBe(true);
    expect(matchesLeadSearch(lead({}), "unassigned")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesLeadSearch(lead({}), "   ")).toBe(true);
  });
});

describe("filterLeads", () => {
  const rows = [
    lead({ full_name: "One", status_id: "s1", event_name: "Health Fair" }),
    lead({ full_name: "Two", status_id: "s2", event_name: "Health Fair" }),
    lead({ full_name: "Pooled", assigned_to_email: null }),
  ];

  it("returns everything when nothing is set", () => {
    expect(filterLeads(rows, EMPTY_LEAD_FILTERS)).toHaveLength(3);
  });

  it("narrows by status and event independently", () => {
    expect(filterLeads(rows, { ...EMPTY_LEAD_FILTERS, statusId: "s1" })).toHaveLength(1);
    expect(filterLeads(rows, { ...EMPTY_LEAD_FILTERS, eventName: "Health Fair" })).toHaveLength(2);
  });

  // "" is not "no filter": it is the pool, which is exactly what a manager
  // looks for when deciding what to hand out.
  it('treats an empty assignee as "in the pool"', () => {
    const pooled = filterLeads(rows, { ...EMPTY_LEAD_FILTERS, assignedTo: "" });
    expect(pooled.map((row) => row.full_name)).toEqual(["Pooled"]);
  });

  it("combines filters with search", () => {
    const result = filterLeads(rows, { ...EMPTY_LEAD_FILTERS, statusId: "s1", search: "one" });
    expect(result.map((row) => row.full_name)).toEqual(["One"]);
  });
});

describe("activeLeadFilterCount", () => {
  it("counts an empty assignee as active, since the pool is a real choice", () => {
    expect(activeLeadFilterCount(EMPTY_LEAD_FILTERS)).toBe(0);
    expect(activeLeadFilterCount({ ...EMPTY_LEAD_FILTERS, assignedTo: "" })).toBe(1);
    expect(activeLeadFilterCount({ ...EMPTY_LEAD_FILTERS, search: "  " })).toBe(0);
    expect(activeLeadFilterCount({ ...EMPTY_LEAD_FILTERS, search: "a" })).toBe(1);
  });
});

describe("filtering by health bucket", () => {
  const rows = [
    lead({ id: "a", full_name: "Never called" }),
    lead({ id: "b", full_name: "Fine" }),
    lead({ id: "c", full_name: "Closed" }),
  ];
  const health = new Map<string, LeadHealth>([
    ["a", "never_contacted"],
    ["b", "on_track"],
    ["c", "closed"],
  ]);

  it("keeps only the leads in that bucket", () => {
    expect(
      filterLeads(rows, { ...EMPTY_LEAD_FILTERS, health: "never_contacted" }, health)
        .map((row) => row.id)
    ).toEqual(["a"]);
  });

  // Every lead has a bucket, so the options together cover the whole list.
  it("covers every row across the buckets", () => {
    const seen = (["never_contacted", "on_track", "closed"] as const).flatMap((bucket) =>
      filterLeads(rows, { ...EMPTY_LEAD_FILTERS, health: bucket }, health).map((row) => row.id)
    );
    expect(seen.sort()).toEqual(["a", "b", "c"]);
  });

  it("counts as an active filter", () => {
    expect(activeLeadFilterCount({ ...EMPTY_LEAD_FILTERS, health: "stale" })).toBe(1);
  });

  // Fail closed: without the map no row can be shown to be in a bucket, which
  // is safer than silently ignoring the filter and showing everything.
  it("matches nothing when no health map is supplied", () => {
    expect(filterLeads(rows, { ...EMPTY_LEAD_FILTERS, health: "stale" })).toEqual([]);
  });
});

describe("lead type filter", () => {
  const fromEvent = lead({ id: "e", event_id: "event-1", event_name: "Health Fair" });
  const personal = lead({ id: "p", event_id: null });
  const rows = [fromEvent, personal];

  // Không có cột lead_type: lead không mang event chính là Personal lead.
  it("splits leads by whether they carry an event", () => {
    expect(filterLeads(rows, { ...EMPTY_LEAD_FILTERS, leadType: "personal" }).map((r) => r.id))
      .toEqual(["p"]);
    expect(filterLeads(rows, { ...EMPTY_LEAD_FILTERS, leadType: "event" }).map((r) => r.id))
      .toEqual(["e"]);
  });

  it("counts as an active filter", () => {
    expect(activeLeadFilterCount({ ...EMPTY_LEAD_FILTERS, leadType: "personal" })).toBe(1);
  });
});

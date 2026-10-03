import { describe, expect, it } from "vitest";
import { summarizeLeads } from "./overview";
import type { LeadAlertSettings, LeadRow, LeadStatus } from "./types";

const settings: LeadAlertSettings = { no_contact_hours: 24, stale_days: 3, max_attempts: 4 };
const NOW = new Date("2026-09-01T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();
const open: LeadStatus = { id: "s1", label: "Open", color: null, position: 0, kind: "open", archived_at: null };
const won: LeadStatus = { ...open, id: "s2", kind: "won" };
const statusById = new Map([["s1", open], ["s2", won]]);

function lead(patch: Partial<LeadRow>): LeadRow {
  return {
    id: Math.random().toString(36), display_number: 1, event_id: "e1",
    full_name: null, phone: "1", email: null, fub_link: null, assigned_to_email: null,
    assigned_at: null, assigned_by_email: null, status_id: "s1", first_contacted_at: null,
    last_contacted_at: null, contact_attempt_count: 0, next_follow_up_at: null,
    closed_at: null, created_by_email: "m@x.com", created_at: hoursAgo(100),
    updated_by_email: null, updated_at: hoursAgo(100), custom_values: {}, archived_at: null,
    ...patch,
  };
}

describe("summarizeLeads", () => {
  it("counts the pool and attributes alerts to the current Agent", () => {
    const result = summarizeLeads([
      lead({}),
      lead({ assigned_to_email: "a@x.com", assigned_at: hoursAgo(30) }),
      lead({ assigned_to_email: "b@x.com", assigned_at: hoursAgo(1) }),
    ], statusById, settings, NOW);
    expect(result.total).toBe(3);
    expect(result.unassigned).toBe(1);
    expect(result.byAlert.never_contacted).toBe(1);
    expect(result.byAgent.find((row) => row.email === "a@x.com")?.redCount).toBe(1);
  });

  it("computes win rate over closed leads only", () => {
    const result = summarizeLeads([
      lead({ status_id: "s2", closed_at: hoursAgo(1) }),
      lead({ status_id: "s1" }), lead({ status_id: "s1" }),
    ], statusById, settings, NOW);
    expect(result.byEvent[0]).toMatchObject({ total: 3, won: 1, closed: 1, winRate: 1 });
  });

  it("uses a null win rate when no leads are closed", () => {
    expect(summarizeLeads([lead({})], statusById, settings, NOW).byEvent[0].winRate).toBeNull();
  });
});

import { resolveLeadAlerts } from "./alerts";
import type { LeadRow } from "./types";
import { describe, expect, it } from "vitest";
import { buildLeadActor } from "./access";
import { buildLeadListFilter, LEAD_PAGE_SIZE } from "./queries";

const manager = buildLeadActor(["lead.manage"], "mgr@x.com");
const agent = buildLeadActor(["lead.work"], "cs@x.com");

describe("buildLeadListFilter", () => {
  it("pins an agent to their own leads whatever they ask for", () => {
    expect(buildLeadListFilter(agent, {
      assigned_to: "someone@else.com",
    }).ownerEmails).toEqual(["cs@x.com"]);
  });

  it("widens an agent to the agents they assist", () => {
    expect(buildLeadListFilter(agent, {}, ["cs@x.com", "boss@x.com"]).ownerEmails)
      .toEqual(["cs@x.com", "boss@x.com"]);
  });

  it("falls back to the actor's own email when no scope is passed", () => {
    expect(buildLeadListFilter(agent, {}).ownerEmails).toEqual(["cs@x.com"]);
  });

  it("lets a manager filter by any agent", () => {
    expect(buildLeadListFilter(manager, {
      assigned_to: "someone@else.com",
    }).ownerEmails).toEqual(["someone@else.com"]);
  });

  it("leaves a manager unfiltered when no agent is named", () => {
    expect(buildLeadListFilter(manager, {}).ownerEmails).toBeNull();
  });

  it("defaults to page one", () => {
    const filter = buildLeadListFilter(manager, {});
    expect(filter.limit).toBe(LEAD_PAGE_SIZE);
    expect(filter.offset).toBe(0);
  });

  it("clamps a hostile page size instead of trusting it", () => {
    expect(buildLeadListFilter(manager, { limit: "99999" }).limit).toBe(LEAD_PAGE_SIZE);
    expect(buildLeadListFilter(manager, { limit: "-5" }).limit).toBe(LEAD_PAGE_SIZE);
    expect(buildLeadListFilter(manager, { limit: "10" }).limit).toBe(10);
  });

  it("accepts a page size up to the PostgREST ceiling", () => {
    expect(buildLeadListFilter(manager, { limit: "1000" }).limit).toBe(1000);
    expect(buildLeadListFilter(manager, { limit: "1001" }).limit).toBe(LEAD_PAGE_SIZE);
  });

  it("accepts supported alert filters and ignores unknown ones", () => {
    expect(buildLeadListFilter(manager, { alert: "stale" }).alert).toBe("stale");
    expect(buildLeadListFilter(manager, { alert: "not-an-alert" }).alert).toBeNull();
  });
});

describe("follow_up_overdue agrees with the alert engine", () => {
  const settings = { no_contact_hours: 24, stale_days: 3, max_attempts: 4 } as const;
  const base = {
    id: "l1", display_number: 1, event_id: null, event_name: null,
    full_name: "A", phone: "1", email: null,
    assigned_to_email: "cs@x.com", assigned_at: "2026-09-01T00:00:00Z",
    assigned_by_email: null, status_id: null,
    first_contacted_at: "2026-09-01T08:00:00Z", last_contacted_at: null,
    contact_attempt_count: 1, next_follow_up_at: null, closed_at: null,
    created_by_email: "m@x.com", created_at: "2026-09-01T00:00:00Z",
    updated_by_email: null, updated_at: "2026-09-01T00:00:00Z",
    custom_values: {}, archived_at: null,
  };
  const now = new Date("2026-09-01T12:00:00Z");

  it("does not flag a promise that was already kept", () => {
    const lead = {
      ...base,
      next_follow_up_at: "2026-09-01T09:00:00Z",
      last_contacted_at: "2026-09-01T10:00:00Z",
    } as unknown as LeadRow;
    expect(resolveLeadAlerts(lead, null, settings, now)).not.toContain("follow_up_overdue");
  });

  it("still flags a promise nobody acted on", () => {
    const lead = {
      ...base,
      next_follow_up_at: "2026-09-01T09:00:00Z",
      last_contacted_at: "2026-09-01T08:00:00Z",
    } as unknown as LeadRow;
    expect(resolveLeadAlerts(lead, null, settings, now)).toContain("follow_up_overdue");
  });
});

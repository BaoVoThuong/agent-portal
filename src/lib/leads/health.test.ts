import { describe, expect, it } from "vitest";
import {
  classifyLeadHealth,
  emptyLeadHealthCounts,
  LEAD_HEALTH_BUCKETS,
} from "./health";
import type { LeadAlertSettings, LeadRow, LeadStatus } from "./types";

const settings: LeadAlertSettings = {
  product: "health", no_contact_hours: 24, stale_days: 3, max_attempts: 4,
};
const NOW = new Date("2026-09-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function lead(patch: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "l1", display_number: 1, product: "health", event_id: null, event_name: null,
    full_name: "A", phone: "1", email: null,
    assigned_to_email: "cs@x.com", assigned_at: daysAgo(10), assigned_by_email: null,
    status_id: null, first_contacted_at: daysAgo(1), last_contacted_at: daysAgo(1),
    contact_attempt_count: 1, next_follow_up_at: null, closed_at: null,
    created_by_email: "m@x.com", created_at: daysAgo(20),
    updated_by_email: null, updated_at: daysAgo(1),
    custom_values: {}, archived_at: null,
    ...patch,
  } as LeadRow;
}
const status = (kind: LeadStatus["kind"]): LeadStatus => ({
  id: "s", label: kind, color: null, position: 0, kind, archived_at: null,
});

describe("classifyLeadHealth", () => {
  it("buckets a healthy assigned lead as on track", () => {
    expect(classifyLeadHealth(lead(), null, settings, NOW)).toBe("on_track");
  });

  it("buckets a pool lead as unassigned, not as never contacted", () => {
    expect(
      classifyLeadHealth(lead({ assigned_to_email: null, assigned_at: null }), null, settings, NOW)
    ).toBe("unassigned");
  });

  it("buckets won and lost as closed whatever else is true", () => {
    const neglected = lead({ first_contacted_at: null, last_contacted_at: null });
    expect(classifyLeadHealth(neglected, status("won"), settings, NOW)).toBe("closed");
    expect(classifyLeadHealth(neglected, status("lost"), settings, NOW)).toBe("closed");
  });

  it("buckets each alert", () => {
    expect(
      classifyLeadHealth(lead({ first_contacted_at: null, last_contacted_at: null }), null, settings, NOW)
    ).toBe("never_contacted");
    expect(
      classifyLeadHealth(lead({ last_contacted_at: daysAgo(9) }), null, settings, NOW)
    ).toBe("stale");
    expect(
      classifyLeadHealth(lead({ contact_attempt_count: 4 }), null, settings, NOW)
    ).toBe("exhausted");
  });

  // A lead can trip several flags at once; the bucket has to pick one, and it
  // picks the one that tells someone what to do next.
  it("picks the most actionable flag when a lead trips several", () => {
    const both = lead({ last_contacted_at: daysAgo(9), contact_attempt_count: 9 });
    expect(classifyLeadHealth(both, null, settings, NOW)).toBe("stale");
  });
});

// The whole point of the buckets: a filter built from them shows every lead
// under exactly one option, so the counts add up and nothing hides in a gap.
describe("the buckets partition the list", () => {
  const rows = [
    lead(),
    lead({ id: "b", assigned_to_email: null, assigned_at: null }),
    lead({ id: "c", first_contacted_at: null, last_contacted_at: null }),
    lead({ id: "d", contact_attempt_count: 4 }),
    lead({ id: "e", last_contacted_at: daysAgo(9) }),
    lead({ id: "f", next_follow_up_at: daysAgo(2), last_contacted_at: daysAgo(5) }),
  ];

  it("gives every lead exactly one bucket, and the counts sum to the total", () => {
    const counts = emptyLeadHealthCounts();
    for (const row of rows) {
      const bucket = classifyLeadHealth(row, null, settings, NOW);
      expect(LEAD_HEALTH_BUCKETS).toContain(bucket);
      counts[bucket] += 1;
    }
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(rows.length);
  });
});

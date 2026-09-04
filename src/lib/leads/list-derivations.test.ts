import { describe, expect, it } from "vitest";
import {
  buildLeadBadges,
  buildLeadLookups,
  collectEventNames,
} from "./list-derivations";
import type { LeadInteractionType, LeadRow, LeadStatus } from "./types";
import type { LeadAlertSettingsByProduct } from "./overview";
import type { TableColumnOption } from "@/lib/table-config/types";

const status = (over: Partial<LeadStatus>): LeadStatus => ({
  id: "s1",
  label: "New",
  color: null,
  position: 1,
  kind: "open",
  archived_at: null,
  ...over,
});

const interactionType = (
  over: Partial<LeadInteractionType>,
): LeadInteractionType => ({
  id: "t1",
  label: "Call",
  color: null,
  position: 1,
  counts_as_contact: true,
  archived_at: null,
  ...over,
});

const option = (over: Partial<TableColumnOption>): TableColumnOption => ({
  id: "o1",
  column_id: "c1",
  label: "Yes",
  color: null,
  position: 1,
  archived_at: null,
  ...over,
});

const lead = (over: Partial<LeadRow>): LeadRow => ({
  id: "l1",
  display_number: 1,
  product: "health",
  products: ["health"],
  event_id: null,
  full_name: "A",
  phone: null,
  email: null,
  assigned_to_email: null,
  assigned_at: null,
  assigned_by_email: null,
  status_id: null,
  first_contacted_at: null,
  last_contacted_at: null,
  contact_attempt_count: 0,
  next_follow_up_at: null,
  closed_at: null,
  created_by_email: "x",
  created_at: "2026-09-01T00:00:00Z",
  updated_by_email: null,
  updated_at: "2026-09-01T00:00:00Z",
  custom_values: {},
  archived_at: null,
  event_name: null,
  interaction_history: [],
  ...over,
});

const settings: LeadAlertSettingsByProduct = {
  pc: { product: "pc", no_contact_hours: 24, stale_days: 3, max_attempts: 4 },
  health: { product: "health", no_contact_hours: 24, stale_days: 3, max_attempts: 4 },
};

describe("buildLeadLookups", () => {
  it("indexes active + archived statuses and keeps a label-only active map", () => {
    const lookups = buildLeadLookups(
      [status({ id: "a", label: "New" })],
      [status({ id: "z", label: "Old", archived_at: "2026-01-01T00:00:00Z" })],
      [interactionType({ id: "call", label: "Call" })],
      [option({ id: "opt", column_id: "col" })],
    );
    expect(lookups.statusById.get("a")?.label).toBe("New");
    expect(lookups.statusById.get("z")?.label).toBe("Old"); // archived still resolvable
    expect(lookups.statusNameById.get("a")).toBe("New");
    expect(lookups.statusNameById.has("z")).toBe(false); // label map is active-only
    expect(lookups.interactionTypeById.get("call")?.label).toBe("Call");
    expect(lookups.optionsByColumn.get("col")).toHaveLength(1);
  });
});

describe("buildLeadBadges", () => {
  it("flags an assigned, never-contacted lead and buckets it once", () => {
    const rows = [
      lead({
        id: "x",
        assigned_to_email: "a@x.co",
        assigned_at: "2026-08-01T00:00:00Z",
      }),
    ];
    const badges = buildLeadBadges(rows, buildLeadLookups([], [], [], []), settings);
    expect(badges.alertsByLeadId.get("x")).toContain("never_contacted");
    expect(badges.healthByLeadId.get("x")).toBe("never_contacted");
    expect(badges.healthCounts.never_contacted).toBe(1);
    expect(badges.healthCounts.on_track).toBe(0);
  });

  it("health buckets partition the list (counts sum to length)", () => {
    const rows = [
      lead({ id: "1" }),
      lead({
        id: "2",
        assigned_to_email: "a@x.co",
        assigned_at: "2026-08-01T00:00:00Z",
      }),
      lead({
        id: "3",
        assigned_to_email: "b@x.co",
        assigned_at: new Date().toISOString(),
      }),
    ];
    const badges = buildLeadBadges(rows, buildLeadLookups([], [], [], []), settings);
    const sum = Object.values(badges.healthCounts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(rows.length);
  });
});

describe("collectEventNames", () => {
  it("returns distinct trimmed names sorted", () => {
    const rows = [
      lead({ id: "1", event_name: "  Health Fair " }),
      lead({ id: "2", event_name: "Health Fair" }),
      lead({ id: "3", event_name: "Auto Expo" }),
      lead({ id: "4", event_name: null }),
    ];
    expect(collectEventNames(rows)).toEqual(["Auto Expo", "Health Fair"]);
  });
});

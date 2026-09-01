import { describe, expect, it } from "vitest";
import { mergeLeadPatch, retainSelection, syncSelectedLead } from "./list-state";
import type { LeadRow } from "./types";

function lead(patch: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "l1", display_number: 1, product: "health", event_id: null, event_name: null,
    full_name: "Anh", phone: "7145550123", email: null,
    assigned_to_email: "cs@x.com", assigned_at: null, assigned_by_email: null,
    status_id: null, first_contacted_at: null, last_contacted_at: null,
    contact_attempt_count: 0, next_follow_up_at: null, closed_at: null,
    created_by_email: "m@x.com", created_at: "2026-09-01T00:00:00Z",
    updated_by_email: null, updated_at: "2026-09-01T00:00:00Z",
    custom_values: {}, archived_at: null,
    ...patch,
  } as LeadRow;
}

describe("mergeLeadPatch", () => {
  it("applies a plain column edit", () => {
    expect(mergeLeadPatch(lead(), { full_name: "Bao" }).full_name).toBe("Bao");
  });

  // The bug: custom_values is sent as one key, and spreading it replaced the
  // whole object, blanking every other custom column on the row.
  it("keeps the other custom values when one is edited", () => {
    const row = lead({ custom_values: { secondary_phone: "111", note: "keep me" } });
    expect(mergeLeadPatch(row, { custom_values: { secondary_phone: "222" } }).custom_values)
      .toEqual({ secondary_phone: "222", note: "keep me" });
  });

  it("does not touch custom values when the patch has none", () => {
    const row = lead({ custom_values: { secondary_phone: "111" } });
    expect(mergeLeadPatch(row, { phone: "9" }).custom_values).toEqual({ secondary_phone: "111" });
  });
});

describe("retainSelection", () => {
  it("keeps rows that survived the refresh", () => {
    const rows = [lead({ id: "a" }), lead({ id: "b" })];
    expect([...retainSelection(new Set(["a", "b"]), rows)]).toEqual(["a", "b"]);
  });

  // Archived, or reassigned out of scope: keeping it would make the next bulk
  // action fail on a row nobody can see.
  it("drops rows that are gone", () => {
    expect([...retainSelection(new Set(["a", "gone"]), [lead({ id: "a" })])]).toEqual(["a"]);
  });

  it("survives an empty refresh without throwing", () => {
    expect([...retainSelection(new Set(["a"]), [])]).toEqual([]);
  });
});

describe("syncSelectedLead", () => {
  it("returns the refreshed copy so the modal stops showing stale fields", () => {
    const fresh = lead({ id: "a", full_name: "Renamed" });
    expect(syncSelectedLead(lead({ id: "a" }), [fresh])).toBe(fresh);
  });

  // Was: `find(...) ?? current` — the modal stayed open on a lead that had been
  // archived or moved out of scope, looking editable until the next save 403'd.
  it("returns null when the row is gone so the modal can close", () => {
    expect(syncSelectedLead(lead({ id: "a" }), [lead({ id: "b" })])).toBeNull();
  });

  it("is a no-op when no modal is open", () => {
    expect(syncSelectedLead(null, [lead()])).toBeNull();
  });
});

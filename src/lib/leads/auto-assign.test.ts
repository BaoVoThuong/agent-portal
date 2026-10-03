import { describe, expect, it } from "vitest";
import { eligibleAssignmentEmails } from "./auto-assign";
import type { AssignmentWeightRow } from "./auto-assign";

const eventA = "11111111-1111-4111-8111-111111111111";
const row = (email: string, over: Partial<AssignmentWeightRow> = {}): AssignmentWeightRow => ({
  event_id: eventA,
  agent_email: email,
  weight: 1,
  current_weight: 0,
  position: 1,
  is_active: true,
  ...over,
});

describe("eligibleAssignmentEmails", () => {
  it("keeps only active weighted Agents with active accounts", () => {
    expect(eligibleAssignmentEmails([
      row("active@x.com"),
      row("disabled-account@x.com"),
      row("off@x.com", { is_active: false }),
      row("zero@x.com", { weight: 0 }),
    ], new Set(["active@x.com", "off@x.com", "zero@x.com"])))
      .toEqual(["active@x.com"]);
  });

  it("matches account emails case-insensitively", () => {
    expect(eligibleAssignmentEmails([row("Ann.S@X.com")], new Set(["ann.s@x.com"])))
      .toEqual(["Ann.S@X.com"]);
  });

  it("returns an empty pool when no Agent account is active", () => {
    expect(eligibleAssignmentEmails([row("a@x.com")], new Set())).toEqual([]);
  });
});

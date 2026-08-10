import { describe, expect, it } from "vitest";
import { toOptimisticEnrollmentPatch } from "@/lib/enrollment/optimistic-patch";

const ACTOR = "me@example.test";
const NOW = "2026-08-11T00:00:00.000Z";

describe("toOptimisticEnrollmentPatch", () => {
  it("translates qc_checked into the columns the UI actually renders", () => {
    expect(toOptimisticEnrollmentPatch({ qc_checked: true }, ACTOR, NOW)).toEqual({
      qc_checked_at: NOW,
      qc_checked_by_email: ACTOR,
      qc_stale_notified_at: null,
    });
  });

  it("clears both columns when qc_checked is false", () => {
    expect(toOptimisticEnrollmentPatch({ qc_checked: false }, ACTOR, NOW)).toEqual({
      qc_checked_at: null,
      qc_checked_by_email: null,
      qc_stale_notified_at: null,
    });
  });

  it("never leaks the request-only key into the row", () => {
    expect(
      "qc_checked" in toOptimisticEnrollmentPatch({ qc_checked: true }, ACTOR, NOW)
    ).toBe(false);
  });

  it("passes ordinary column patches through untouched", () => {
    expect(
      toOptimisticEnrollmentPatch({ client_name: "A", stage_id: "s1" }, ACTOR, NOW)
    ).toEqual({ client_name: "A", stage_id: "s1" });
  });

  it("keeps other keys when qc_checked travels alongside them", () => {
    expect(
      toOptimisticEnrollmentPatch({ qc_checked: true, client_name: "A" }, ACTOR, NOW)
    ).toEqual({
      client_name: "A",
      qc_checked_at: NOW,
      qc_checked_by_email: ACTOR,
      qc_stale_notified_at: null,
    });
  });

  it("ignores a non-boolean qc_checked, matching the server guard", () => {
    // route.ts only acts when typeof body.qc_checked === "boolean".
    expect(toOptimisticEnrollmentPatch({ qc_checked: "yes" }, ACTOR, NOW)).toEqual({
      qc_checked: "yes",
    });
  });

  it("does not mutate the patch it was given", () => {
    const patch = { qc_checked: true, client_name: "A" };
    toOptimisticEnrollmentPatch(patch, ACTOR, NOW);
    expect(patch).toEqual({ qc_checked: true, client_name: "A" });
  });
});

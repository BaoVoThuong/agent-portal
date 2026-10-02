import { describe, expect, it } from "vitest";
import {
  canRetryAfterConflict,
  toOptimisticEnrollmentPatch,
} from "@/lib/enrollment/optimistic-patch";

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

  // Như trigger trong DB: carrier_id luôn là hãng đầu. Bỏ tick hãng cuối mà
  // không làm vậy thì dòng lạc quan còn giữ carrier_id cũ, và mọi chỗ rơi về
  // carrier_id hiện lại đúng hãng vừa bỏ.
  it("mirrors the first carrier into carrier_id", () => {
    expect(toOptimisticEnrollmentPatch({ carrier_ids: ["c2", "c1"] }, ACTOR, NOW)).toEqual({
      carrier_ids: ["c2", "c1"],
      carrier_id: "c2",
    });
    expect(toOptimisticEnrollmentPatch({ carrier_ids: [] }, ACTOR, NOW)).toEqual({
      carrier_ids: [],
      carrier_id: null,
    });
  });
});

// Lỗi 2026-09-30: tạo hồ sơ kèm file → upload đẩy updated_at lên → lượt sửa
// đầu tiên bị 409 và bị bỏ, dù không ai đụng tới trường đó.
describe("canRetryAfterConflict", () => {
  const before = {
    updated_at: "2026-09-30T15:59:00.000Z",
    stage_id: "stage-1",
    client_name: "Client",
    closed_at: null,
    carrier_id: "c1",
    qc_checked_at: null,
    qc_checked_by_email: null,
    qc_stale_notified_at: null,
    carrier_ids: ["c1"],
    custom_values: { year: "2026", note: "a" },
  };

  it("retries when only the timestamp moved (file upload, reaction...)", () => {
    const canonical = { ...before, updated_at: "2026-09-30T15:59:05.000Z" };
    expect(canRetryAfterConflict({ stage_id: "stage-2" }, before, canonical)).toBe(true);
  });

  it("retries when someone else changed a DIFFERENT field", () => {
    const canonical = { ...before, updated_at: "later", client_name: "Renamed" };
    expect(canRetryAfterConflict({ stage_id: "stage-2" }, before, canonical)).toBe(true);
  });

  it("does not retry when someone else changed the SAME field", () => {
    const canonical = { ...before, updated_at: "later", stage_id: "stage-9" };
    expect(canRetryAfterConflict({ stage_id: "stage-2" }, before, canonical)).toBe(false);
  });

  it("compares carrier lists by content and order", () => {
    const same = { ...before, updated_at: "later", carrier_ids: ["c1"] };
    const changed = { ...before, updated_at: "later", carrier_ids: ["c2", "c1"] };
    expect(canRetryAfterConflict({ carrier_ids: ["c1", "c3"] }, before, same)).toBe(true);
    expect(canRetryAfterConflict({ carrier_ids: ["c1", "c3"] }, before, changed)).toBe(false);
  });

  it("compares custom_values key by key", () => {
    const otherKeyChanged = {
      ...before,
      updated_at: "later",
      custom_values: { year: "2026", note: "b" },
    };
    expect(
      canRetryAfterConflict({ custom_values: { year: "2027" } }, before, otherKeyChanged),
    ).toBe(true);
    expect(
      canRetryAfterConflict({ custom_values: { note: "c" } }, before, otherKeyChanged),
    ).toBe(false);
  });

  it("maps qc_checked to qc_checked_at and ignores request-only keys", () => {
    const qcChanged = { ...before, updated_at: "later", qc_checked_at: "2026-09-30T16:00:00Z" };
    expect(canRetryAfterConflict({ qc_checked: true }, before, qcChanged)).toBe(false);
    const untouched = { ...before, updated_at: "later" };
    expect(
      canRetryAfterConflict({ stage_id: "s2", reopen_reason: "why" }, before, untouched),
    ).toBe(true);
  });

  it("does not retry a stage change over concurrent close or QC changes", () => {
    const closed = { ...before, updated_at: "later", closed_at: "2026-09-30T16:00:00Z" };
    const qcReviewed = {
      ...before,
      updated_at: "later",
      qc_checked_at: "2026-09-30T16:00:00Z",
      qc_checked_by_email: ACTOR,
    };
    expect(canRetryAfterConflict({ stage_id: "stage-2" }, before, closed)).toBe(false);
    expect(canRetryAfterConflict({ stage_id: "stage-2" }, before, qcReviewed)).toBe(false);
  });

  it("does not retry a QC action after the stage changed", () => {
    const canonical = { ...before, updated_at: "later", stage_id: "stage-2" };
    expect(canRetryAfterConflict({ qc_checked: true }, before, canonical)).toBe(false);
  });

  it("checks the legacy primary carrier column as well as carrier_ids", () => {
    const canonical = { ...before, updated_at: "later", carrier_id: "c2" };
    expect(canRetryAfterConflict({ carrier_ids: ["c1", "c3"] }, before, canonical)).toBe(false);
  });

  it("does not guess about a field the record does not have", () => {
    const canonical = { ...before, updated_at: "later" };
    expect(canRetryAfterConflict({ mystery_field: 1 }, before, canonical)).toBe(false);
  });
});

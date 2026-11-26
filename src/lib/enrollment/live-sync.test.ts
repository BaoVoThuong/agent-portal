import { describe, expect, it } from "vitest";
import {
  canRefreshEnrollmentData,
  enrollmentBroadcastReconcileScope,
  enrollmentInvalidationReconcileScope,
  enrollmentLivePollInterval,
  enrollmentRefetchDisposition,
  enrollmentTabTag,
  ENROLLMENT_LIST_RECONCILE_MS,
  ENROLLMENT_LIVE_RECONCILE_MS,
  mergeEnrollmentReconcileScope,
  parseEnrollmentRefetchReason,
  parseEnrollmentTabTag,
} from "./live-sync";

describe("enrollment live sync", () => {
  it("ignores its own invalidation and narrows other record updates", () => {
    expect(
      enrollmentInvalidationReconcileScope(
        { origin: "document", recordId: "e1", sourceId: "mine" },
        "mine",
      ),
    ).toBeNull();
    expect(
      enrollmentInvalidationReconcileScope(
        { origin: "document", recordId: "e1", sourceId: "other" },
        "mine",
      ),
    ).toBe("enrollments-only");
  });

  it("merges full invalidation scope", () => {
    expect(mergeEnrollmentReconcileScope("enrollments-only", "full")).toBe("full");
    expect(enrollmentBroadcastReconcileScope("mine", "mine")).toBeNull();
  });

  it("defers a refetch while a write is pending", () => {
    expect(
      enrollmentRefetchDisposition({
        writeVersionAtStart: 1,
        currentWriteVersion: 1,
        pendingMutationCount: 1,
      }),
    ).toBe("defer");
    expect(
      enrollmentRefetchDisposition({
        writeVersionAtStart: 1,
        currentWriteVersion: 2,
        pendingMutationCount: 0,
      }),
    ).toBe("retry");
  });

  it("only refreshes visible online pages", () => {
    expect(canRefreshEnrollmentData("visible", true)).toBe(true);
    expect(canRefreshEnrollmentData("hidden", true)).toBe(false);
    expect(enrollmentLivePollInterval("degraded")).toBeLessThan(
      enrollmentLivePollInterval("live"),
    );
  });

  it("does not poll the full list faster when Realtime is degraded", () => {
    expect(ENROLLMENT_LIST_RECONCILE_MS).toBe(ENROLLMENT_LIVE_RECONCILE_MS);
  });

  it("accepts only known refetch reasons", () => {
    expect(parseEnrollmentRefetchReason("broadcast")).toBe("broadcast");
    expect(parseEnrollmentRefetchReason("poll")).toBe("poll");
    expect(parseEnrollmentRefetchReason("x@example.com")).toBe("other");
    expect(parseEnrollmentRefetchReason(null)).toBe("other");
  });

  it("derives a short random tab tag from the live source id", () => {
    expect(
      enrollmentTabTag("enrollment-aca:m3k2:0f8e7d6c-1111-2222-3333-444455556666"),
    ).toBe("0f8e7d6c");
    expect(enrollmentTabTag("enrollment-aca:m3k2:Ab-12")).toBe("ab12");
    expect(enrollmentTabTag("")).toBe("none");
  });

  it("accepts only short lowercase tab tags", () => {
    expect(parseEnrollmentTabTag("0f8e7d6c")).toBe("0f8e7d6c");
    expect(parseEnrollmentTabTag("x@example.com")).toBe("none");
    expect(parseEnrollmentTabTag("0123456789")).toBe("none");
    expect(parseEnrollmentTabTag(null)).toBe("none");
  });
});


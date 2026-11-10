import { describe, expect, it } from "vitest";
import {
  canRefreshEnrollmentData,
  enrollmentBroadcastReconcileScope,
  enrollmentInvalidationReconcileScope,
  enrollmentLivePollInterval,
  enrollmentRefetchDisposition,
  ENROLLMENT_LIST_RECONCILE_MS,
  ENROLLMENT_LIVE_RECONCILE_MS,
  mergeEnrollmentReconcileScope,
  parseEnrollmentRefetchReason,
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
});


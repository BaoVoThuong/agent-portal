import { describe, expect, it } from "vitest";
import {
  canRefreshEnrollmentData,
  enrollmentBroadcastReconcileScope,
  enrollmentInvalidationReconcileScope,
  enrollmentLivePollInterval,
  enrollmentRefetchDisposition,
  mergeEnrollmentReconcileScope,
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
});


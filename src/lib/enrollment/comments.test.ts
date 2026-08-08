import { describe, expect, it } from "vitest";
import { resolveEnrollmentParentUpdatedAt } from "@/lib/enrollment/comments";

describe("resolveEnrollmentParentUpdatedAt", () => {
  it("prefers the canonical refetch over a write response", () => {
    expect(
      resolveEnrollmentParentUpdatedAt("canonical", "write-response")
    ).toBe("canonical");
  });

  it("uses the persisted write version when the canonical refetch is unavailable", () => {
    expect(resolveEnrollmentParentUpdatedAt(null, "write-response")).toBe("write-response");
  });

  it("does not invent a token when the parent write did not persist", () => {
    expect(resolveEnrollmentParentUpdatedAt(null, null)).toBeNull();
  });
});

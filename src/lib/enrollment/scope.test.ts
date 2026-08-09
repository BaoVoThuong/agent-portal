import { describe, expect, it } from "vitest";
import { isRecordInScope } from "./scope";

describe("isRecordInScope", () => {
  it("lets an unscoped viewer see everything, including null-agent records", () => {
    expect(isRecordInScope({ seeAll: true }, "a@x.com")).toBe(true);
    expect(isRecordInScope({ seeAll: true }, null)).toBe(true);
  });

  it("lets a scoped viewer see only their agents", () => {
    const scope = {
      seeAll: false as const,
      agentEmails: ["a@x.com", "b@x.com"],
    };
    expect(isRecordInScope(scope, "a@x.com")).toBe(true);
    expect(isRecordInScope(scope, "c@x.com")).toBe(false);
  });

  it("hides null-agent records from a scoped viewer", () => {
    expect(
      isRecordInScope({ seeAll: false, agentEmails: ["a@x.com"] }, null)
    ).toBe(false);
  });

  it("hides everything from a scoped viewer with no agents", () => {
    expect(
      isRecordInScope({ seeAll: false, agentEmails: [] }, "a@x.com")
    ).toBe(false);
  });

  it("compares case-insensitively", () => {
    expect(
      isRecordInScope(
        { seeAll: false, agentEmails: ["A@X.com"] },
        "a@x.COM"
      )
    ).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { applyEnrollmentScope, isRecordInScope } from "./scope";

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

describe("applyEnrollmentScope", () => {
  function queryDouble() {
    const query = {
      eq: vi.fn(),
      in: vi.fn(),
    };
    query.eq.mockReturnValue(query);
    query.in.mockReturnValue(query);
    return query;
  }

  it("leaves a see-all query unchanged", () => {
    const query = queryDouble();
    expect(applyEnrollmentScope(query, { seeAll: true })).toBe(query);
    expect(query.eq).not.toHaveBeenCalled();
    expect(query.in).not.toHaveBeenCalled();
  });

  it("filters a scoped query by covered agent emails", () => {
    const query = queryDouble();
    applyEnrollmentScope(query, {
      seeAll: false,
      agentEmails: ["agent@x.com"],
    });
    expect(query.in).toHaveBeenCalledWith("agent_email", ["agent@x.com"]);
  });

  it("matches nothing when a scoped actor covers no agents", () => {
    const query = queryDouble();
    applyEnrollmentScope(query, { seeAll: false, agentEmails: [] });
    expect(query.eq).toHaveBeenCalledWith(
      "id",
      "00000000-0000-0000-0000-000000000000"
    );
  });
});

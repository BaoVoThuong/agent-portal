import { describe, expect, it } from "vitest";
import { safeErrorFields } from "./server-error-log";

describe("safeErrorFields", () => {
  it("keeps useful database diagnostics", () => {
    const error = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    expect(safeErrorFields(error)).toEqual({
      name: "Error", code: "57014", message: "canceling statement due to statement timeout",
    });
  });

  it("limits long messages", () => {
    expect(safeErrorFields(new Error("x".repeat(1000))).message).toHaveLength(300);
  });

  it("redacts obvious personal data and credentials", () => {
    const message = safeErrorFields(new Error("user foo@example.com token Bearer abc123 value 'Customer Name'")).message;
    expect(message).not.toContain("foo@example.com");
    expect(message).not.toContain("abc123");
    expect(message).not.toContain("Customer Name");
  });

  it("does not leak non-Error thrown values", () => {
    expect(safeErrorFields({ email: "a@b.com" })).toEqual({
      name: "unknown", code: null, message: "non-Error thrown",
    });
  });
});

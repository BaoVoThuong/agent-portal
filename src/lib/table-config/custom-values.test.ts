import { describe, expect, it } from "vitest";
import { customValueIssuesMessage, validateCustomValues } from "./custom-values";
import type { WriteValidationContext } from "./custom-values";

const context: WriteValidationContext = {
  columns: [
    {
      id: "col-text", scope: "cs", key: "note", label: "Note", type: "text",
      is_system: false, position: 1, pinned: false, hidden_default: false,
      show_in_detail: true, required: false, archived_at: null,
    },
    {
      id: "col-choice", scope: "cs", key: "choice", label: "Choice", type: "dropdown",
      is_system: false, position: 2, pinned: false, hidden_default: false,
      show_in_detail: true, required: false, archived_at: null,
    },
    {
      id: "col-multi", scope: "cs", key: "multi", label: "Multi", type: "multiselect",
      is_system: false, position: 3, pinned: false, hidden_default: false,
      show_in_detail: true, required: false, archived_at: null,
    },
    {
      id: "col-person", scope: "cs", key: "owner", label: "Owner", type: "person",
      is_system: false, position: 4, pinned: false, hidden_default: false,
      show_in_detail: true, required: false, archived_at: null,
    },
  ],
  options: [
    { id: "choice-a", column_id: "col-choice", label: "A", color: null, position: 1, archived_at: null },
    { id: "multi-a", column_id: "col-multi", label: "A", color: null, position: 1, archived_at: null },
    { id: "multi-b", column_id: "col-multi", label: "B", color: null, position: 2, archived_at: null },
  ],
  matchedPersonEmails: ["person@example.com"],
};

describe("validateCustomValues", () => {
  it("accepts valid scalars, option ids and explicit null", () => {
    expect(validateCustomValues({ note: "ok", choice: "choice-a", owner: null }, context)).toEqual({
      ok: true,
      values: { note: "ok", choice: "choice-a", owner: null },
    });
  });

  it("rejects unknown keys and invalid options", () => {
    const result = validateCustomValues({ missing: "x", choice: "wrong" }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.reason)).toEqual(["unknown-column", "invalid-option"]);
  });

  it("accepts multiple valid option ids and rejects one invalid id", () => {
    expect(validateCustomValues({ multi: ["multi-a", "multi-b"] }, context)).toEqual({
      ok: true,
      values: { multi: ["multi-a", "multi-b"] },
    });
    expect(validateCustomValues({ multi: ["multi-a", "wrong"] }, context).ok).toBe(false);
  });

  it("requires a matched Person email and keeps the message safe", () => {
    const result = validateCustomValues({ owner: "unknown@example.com" }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(customValueIssuesMessage(result.issues)).toBe("Invalid custom value: Owner.");
  });

  it("rejects arrays and primitives as the top-level value", () => {
    expect(validateCustomValues([], context).ok).toBe(false);
    expect(validateCustomValues(null, context).ok).toBe(false);
  });
});

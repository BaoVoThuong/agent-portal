import { describe, expect, it } from "vitest";
import { canApproveImport, classifyImportRows } from "./import";
import type { TableColumn } from "./types";

const col = (
  key: string,
  type: TableColumn["type"] = "text",
  label = key
): TableColumn => ({
  id: key,
  scope: "cs",
  key,
  label,
  type,
  is_system: false,
  position: 0,
  pinned: false,
  hidden_default: false,
  show_in_detail: false,
  required: false,
  archived_at: null,
});

describe("classifyImportRows", () => {
  it("classifies add/update/error rows", () => {
    const result = classifyImportRows(
      [
        { fub: "A", amount: "5" },
        { fub: "B", amount: "9" },
        { fub: "", amount: "bad" },
      ],
      [col("fub"), col("amount", "number", "Amount")],
      "fub",
      new Map([["a", "record-1"]])
    );
    expect(result.summary).toEqual({
      addCount: 1,
      updateCount: 1,
      errorCount: 1,
    });
    expect(result.rows.map((row) => row.action)).toEqual([
      "update",
      "add",
      "error",
    ]);
  });

  it("uses import context type overrides", () => {
    const result = classifyImportRows(
      [{ client: "A", consent: "Yes" }],
      [
        col("client"),
        { ...col("consent", "checkbox", "Consent"), is_system: true },
      ],
      "client",
      new Map(),
      {
        consent: {
          typeOverride: "dropdown",
          optionIds: new Set(["consent-yes"]),
          optionIdByLabel: new Map([["yes", "consent-yes"]]),
        },
      }
    );

    expect(result.rows[0]).toMatchObject({
      action: "add",
      values: { client: "A", consent: "consent-yes" },
      errors: [],
    });
  });
});

describe("canApproveImport", () => {
  it("blocks self approval", () => {
    expect(
      canApproveImport(
        { submitted_by_email: "a@example.com", status: "pending" },
        "A@example.com"
      ).ok
    ).toBe(false);
    expect(
      canApproveImport(
        { submitted_by_email: "a@example.com", status: "pending" },
        "b@example.com"
      ).ok
    ).toBe(true);
  });
});

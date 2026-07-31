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
  hidden_default: false,
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

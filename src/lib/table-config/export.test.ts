import { describe, expect, it } from "vitest";
import { buildExportMatrix } from "./export";
import type { TableColumn } from "./types";

const col = (key: string, label: string): TableColumn => ({
  id: key,
  scope: "aca",
  key,
  label,
  type: "text",
  is_system: true,
  position: 0,
  pinned: false,
  hidden_default: false,
  required: false,
  archived_at: null,
});

type Row = { client: string; note: unknown };

describe("buildExportMatrix", () => {
  it("uses column labels for header and formats values in order", () => {
    const matrix = buildExportMatrix(
      [
        { client: "An", note: 5 },
        { client: "Bao", note: null },
      ] satisfies Row[],
      [col("client", "Client Name"), col("note", "Note")],
      (row, key) => (row as unknown as Record<string, unknown>)[key],
      (_column, raw) => (raw == null ? "" : String(raw))
    );
    expect(matrix.header).toEqual(["Client Name", "Note"]);
    expect(matrix.rows).toEqual([
      ["An", "5"],
      ["Bao", ""],
    ]);
  });
});

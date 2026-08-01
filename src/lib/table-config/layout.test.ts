import { describe, expect, it } from "vitest";
import { applyLayoutChange, resolveLayout, serializeLayout } from "./layout";
import type { TableColumn } from "./types";

const col = (
  key: string,
  position: number,
  over: Partial<TableColumn> = {}
): TableColumn => ({
  id: key,
  scope: "aca",
  key,
  label: key.toUpperCase(),
  type: "text",
  is_system: false,
  position,
  pinned: false,
  hidden_default: false,
  show_in_detail: false,
  required: false,
  archived_at: null,
  ...over,
});

const cols = [
  col("a", 10),
  col("b", 20),
  col("c", 30, { hidden_default: true }),
];

describe("resolveLayout", () => {
  it("uses default order and hidden_default when layout is missing", () => {
    const resolved = resolveLayout(cols, null);
    expect(resolved.map((column) => column.key)).toEqual(["a", "b", "c"]);
    expect(resolved.find((column) => column.key === "c")!.hidden).toBe(true);
    expect(resolved.find((column) => column.key === "a")!.width).toBeNull();
  });

  it("applies user order, width, and hidden overrides", () => {
    const resolved = resolveLayout(cols, [
      { column_key: "b", position: 0, width: 250, hidden: false },
      { column_key: "a", position: 1, width: null, hidden: true },
    ]);
    expect(resolved.map((column) => column.key)).toEqual(["b", "a", "c"]);
    expect(resolved.find((column) => column.key === "b")!.width).toBe(250);
    expect(resolved.find((column) => column.key === "a")!.hidden).toBe(true);
  });

  it("ignores stale layout keys", () => {
    expect(
      resolveLayout(cols, [
        { column_key: "gone", position: 0, width: 100, hidden: false },
      ]).map((column) => column.key)
    ).toEqual(["a", "b", "c"]);
  });
});

describe("serializeLayout", () => {
  it("preserves resolved layout order", () => {
    const resolved = resolveLayout(cols, [
      { column_key: "b", position: 0, width: 200, hidden: true },
    ]);
    expect(serializeLayout(resolved)[0]).toMatchObject({
      column_key: "b",
      position: 0,
      width: 200,
      hidden: true,
    });
  });
});

describe("applyLayoutChange", () => {
  it("reorders by key list", () => {
    expect(
      applyLayoutChange(resolveLayout(cols, null), {
        reorder: ["c", "a", "b"],
      }).map((column) => column.key)
    ).toEqual(["c", "a", "b"]);
  });

  it("updates one column width and hidden flag", () => {
    const resized = applyLayoutChange(resolveLayout(cols, null), {
      key: "a",
      width: 300,
    });
    expect(resized.find((column) => column.key === "a")!.width).toBe(300);
    expect(
      applyLayoutChange(resized, { key: "a", hidden: true }).find(
        (column) => column.key === "a"
      )!.hidden
    ).toBe(true);
  });
});

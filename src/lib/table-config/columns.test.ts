import { describe, expect, it } from "vitest";
import {
  canEditColumnField,
  nextPosition,
  slugifyColumnKey,
  sortColumns,
} from "./columns";
import type { TableColumn } from "./types";

const col = (key: string, position: number, label = key): TableColumn => ({
  id: key,
  scope: "aca",
  key,
  label,
  type: "text",
  is_system: false,
  position,
  hidden_default: false,
  required: false,
  archived_at: null,
});

describe("slugifyColumnKey", () => {
  it("builds stable snake-case keys", () => {
    expect(slugifyColumnKey("FUB Link 2026!")).toBe("fub_link_2026");
    expect(slugifyColumnKey("   ")).toBe("custom_column");
  });
});

describe("sortColumns", () => {
  it("sorts by position then label then key", () => {
    expect(sortColumns([col("b", 20), col("c", 10), col("a", 20)]).map((c) => c.key))
      .toEqual(["c", "a", "b"]);
  });
});

describe("canEditColumnField", () => {
  it("locks destructive system-column fields", () => {
    const system = { is_system: true };
    expect(canEditColumnField(system, "label")).toBe(true);
    expect(canEditColumnField(system, "position")).toBe(true);
    expect(canEditColumnField(system, "hidden_default")).toBe(true);
    expect(canEditColumnField(system, "type")).toBe(false);
    expect(canEditColumnField(system, "archived_at")).toBe(false);
  });
});

describe("nextPosition", () => {
  it("increments by ten from the largest position", () => {
    expect(nextPosition([])).toBe(10);
    expect(nextPosition([col("a", 10), col("b", 50)])).toBe(60);
  });
});

import { describe, expect, it } from "vitest";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import {
  formatProviderActivityValue,
  providerActivityChanges,
  providerActivityFieldLabel,
  providerFieldChanges,
} from "./activity";

describe("providerFieldChanges", () => {
  it("lists only the fields whose stored value changed", () => {
    expect(
      providerFieldChanges(
        { phone: "(111) 111-1111", city: "Austin", needs_review: true },
        { phone: "(222) 222-2222", city: "Austin", needs_review: false }
      )
    ).toEqual([
      { key: "phone", from: "(111) 111-1111", to: "(222) 222-2222" },
      { key: "needs_review", from: true, to: false },
    ]);
  });

  it("treats null, empty text and empty lists as the same blank value", () => {
    expect(
      providerFieldChanges(
        { street: null, custom_values: { tags: [] } },
        { street: "", custom_values: { tags: null } }
      )
    ).toEqual([]);
  });

  it("diffs custom values by key, including keys that appear or disappear", () => {
    expect(
      providerFieldChanges(
        { custom_values: { a: "x", gone: "y" } },
        { custom_values: { a: "x", added: ["p", "q"] } }
      )
    ).toEqual([
      { key: "gone", from: "y", to: null },
      { key: "added", from: null, to: ["p", "q"] },
    ]);
  });
});

describe("activity display", () => {
  const column = { id: "c1", key: "plan", label: "Plan" } as TableColumn;
  const options = [
    { id: "o1", column_id: "c1", label: "Gold" },
    { id: "o2", column_id: "other", label: "Silver" },
  ] as TableColumnOption[];

  it("maps option ids to the labels of that column only", () => {
    expect(formatProviderActivityValue(["o1", "o2"], column, options)).toBe("Gold, o2");
    expect(formatProviderActivityValue("o1", column, options)).toBe("Gold");
  });

  it("writes blanks and booleans the way the table reads them", () => {
    expect(formatProviderActivityValue(null, column, options)).toBe("—");
    expect(formatProviderActivityValue(true, undefined, [])).toBe("Yes");
  });

  it("falls back to the key when a column is gone", () => {
    expect(providerActivityFieldLabel("zip_code", [])).toBe("zip code");
    expect(providerActivityFieldLabel("plan", [column])).toBe("Plan");
  });

  it("ignores malformed change entries", () => {
    expect(providerActivityChanges({ changes: [{ key: "a", from: 1, to: 2 }, null, "x"] })).toEqual([
      { key: "a", from: 1, to: 2 },
    ]);
    expect(providerActivityChanges(null)).toEqual([]);
  });
});

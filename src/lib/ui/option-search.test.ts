import { describe, expect, it } from "vitest";
import {
  filterSearchableChoices,
  initialEnabledChoiceIndex,
  moveEnabledChoiceIndex,
  normalizeOptionSearchText,
  type SearchableChoice,
} from "./option-search";

const choices: SearchableChoice[] = [
  { value: "a", label: "Ambetter EPO" },
  { value: "b", label: "BCBS Blue Advantage" },
  { value: "c", label: "Bảo Võ", keywords: ["bao.vo@example.com"] },
  { value: "d", label: "Đỗ Brown", disabled: true },
  { value: "e", label: "Kaiser" },
];

describe("normalizeOptionSearchText", () => {
  it("normalizes case, whitespace, accents, and Vietnamese đ/Đ", () => {
    expect(normalizeOptionSearchText("  BẢO   Võ ")).toBe("bao vo");
    expect(normalizeOptionSearchText("Đỗ   Brown")).toBe("do brown");
  });
});

describe("filterSearchableChoices", () => {
  it("returns a new source-ordered list for an empty query", () => {
    const result = filterSearchableChoices(choices, "  ");
    expect(result).toEqual(choices);
    expect(result).not.toBe(choices);
  });

  it("matches case-insensitively and by substring", () => {
    expect(filterSearchableChoices(choices, "blue").map((choice) => choice.value)).toEqual([
      "b",
    ]);
  });

  it("requires every query token and preserves source order", () => {
    expect(
      filterSearchableChoices(
        [...choices].reverse(),
        "adv blue"
      ).map((choice) => choice.value)
    ).toEqual(["b"]);
  });

  it("matches accents and aliases such as email", () => {
    expect(filterSearchableChoices(choices, "bao").map((choice) => choice.value)).toEqual([
      "c",
    ]);
    expect(
      filterSearchableChoices(choices, "EXAMPLE.COM").map((choice) => choice.value)
    ).toEqual(["c"]);
  });

  it("returns an empty result when nothing matches", () => {
    expect(filterSearchableChoices(choices, "does-not-exist")).toEqual([]);
  });
});

describe("enabled choice navigation", () => {
  it("starts at the selected enabled choice, then first enabled choice", () => {
    expect(initialEnabledChoiceIndex(choices, "e")).toBe(4);
    expect(initialEnabledChoiceIndex(choices, "missing")).toBe(0);
    expect(initialEnabledChoiceIndex(choices, "d")).toBe(0);
    expect(initialEnabledChoiceIndex([{ value: "x", label: "X", disabled: true }])).toBe(-1);
  });

  it("skips disabled choices and clamps at both ends", () => {
    expect(moveEnabledChoiceIndex(choices, 0, 1)).toBe(1);
    expect(moveEnabledChoiceIndex(choices, 1, 1)).toBe(2);
    expect(moveEnabledChoiceIndex(choices, 2, 1)).toBe(4);
    expect(moveEnabledChoiceIndex(choices, 4, 1)).toBe(4);
    expect(moveEnabledChoiceIndex(choices, 4, -1)).toBe(2);
    expect(moveEnabledChoiceIndex(choices, 0, -1)).toBe(0);
    expect(moveEnabledChoiceIndex(choices, -1, -1)).toBe(4);
    expect(moveEnabledChoiceIndex([], 0, 1)).toBe(-1);
  });
});

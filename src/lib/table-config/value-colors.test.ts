import { describe, expect, it } from "vitest";
import { TASK_CATEGORY_COLORS } from "@/lib/tasks/category-colors";
import {
  DEFAULT_DROPDOWN_VALUE_COLOR,
  nextRecommendedDropdownValueColor,
  recommendDropdownValueColor,
} from "./value-colors";

describe("recommendDropdownValueColor", () => {
  it("starts with the shared palette default", () => {
    expect(recommendDropdownValueColor([])).toBe(DEFAULT_DROPDOWN_VALUE_COLOR);
  });

  it("recommends the least-used shared colour", () => {
    expect(
      recommendDropdownValueColor([
        TASK_CATEGORY_COLORS[0],
        TASK_CATEGORY_COLORS[0],
        TASK_CATEGORY_COLORS[1],
      ])
    ).toBe(TASK_CATEGORY_COLORS[2]);
  });

  it("matches configured colours case-insensitively", () => {
    expect(recommendDropdownValueColor([TASK_CATEGORY_COLORS[0].toUpperCase()])).toBe(
      TASK_CATEGORY_COLORS[1]
    );
  });

  it("ignores null and malformed values", () => {
    expect(recommendDropdownValueColor([null, "", "not-a-colour"])).toBe(
      DEFAULT_DROPDOWN_VALUE_COLOR
    );
  });

  it("cycles deterministically after every palette colour is used", () => {
    expect(recommendDropdownValueColor([...TASK_CATEGORY_COLORS])).toBe(
      DEFAULT_DROPDOWN_VALUE_COLOR
    );
  });

  it("moves to the next ranked recommendation and wraps", () => {
    const existing = [TASK_CATEGORY_COLORS[0]];
    const first = recommendDropdownValueColor(existing);
    const second = nextRecommendedDropdownValueColor(first, existing);

    expect(first).toBe(TASK_CATEGORY_COLORS[1]);
    expect(second).toBe(TASK_CATEGORY_COLORS[2]);
    expect(
      nextRecommendedDropdownValueColor(
        TASK_CATEGORY_COLORS[TASK_CATEGORY_COLORS.length - 1],
        [...TASK_CATEGORY_COLORS]
      )
    ).toBe(DEFAULT_DROPDOWN_VALUE_COLOR);
  });

  it("starts from the best recommendation when the current colour is custom", () => {
    expect(nextRecommendedDropdownValueColor("#123456", [])).toBe(
      DEFAULT_DROPDOWN_VALUE_COLOR
    );
  });
});

import { describe, expect, it } from "vitest";
import { TASK_CATEGORY_COLORS } from "@/lib/tasks/category-colors";
import { taskCategoryBadgePalette } from "@/lib/tasks/category-colors";
import {
  CONFIGURED_COLOR_ERROR,
  DEFAULT_DROPDOWN_VALUE_COLOR,
  nextRecommendedDropdownValueColor,
  normalizeConfiguredColor,
  parseConfiguredColor,
  recommendDropdownValueColor,
  tableColumnOptionBadgePalette,
} from "./value-colors";

describe("tableColumnOptionBadgePalette", () => {
  it("matches the category badge palette used by list consumers", () => {
    const option = { id: "option-1", label: "Call Doctor Office", color: "#FFAB00" };
    expect(tableColumnOptionBadgePalette(option)).toEqual(
      taskCategoryBadgePalette({
        id: option.id,
        name: option.label,
        color: "#ffab00",
      })
    );
  });

  it("uses the same deterministic fallback for missing or legacy-invalid colors", () => {
    expect(tableColumnOptionBadgePalette({ id: "option-1", label: "Value", color: null })).toEqual(
      tableColumnOptionBadgePalette({ id: "option-1", label: "Value", color: "#123" })
    );
  });
});

describe("parseConfiguredColor", () => {
  it("normalizes valid colors to lowercase", () => {
    expect(parseConfiguredColor("  #0C66E4 ")).toEqual({
      ok: true,
      color: "#0c66e4",
    });
  });

  it("allows an explicit clear", () => {
    expect(parseConfiguredColor(null)).toEqual({ ok: true, color: null });
    expect(parseConfiguredColor(" ")).toEqual({ ok: true, color: null });
  });

  it("rejects malformed non-empty values instead of silently clearing them", () => {
    expect(parseConfiguredColor("red")).toEqual({
      ok: false,
      error: CONFIGURED_COLOR_ERROR,
    });
    expect(parseConfiguredColor(123)).toEqual({
      ok: false,
      error: CONFIGURED_COLOR_ERROR,
    });
  });

  it("provides a safe normalized value for rendering", () => {
    expect(normalizeConfiguredColor("#ABCDEF")).toBe("#abcdef");
    expect(normalizeConfiguredColor("invalid")).toBeNull();
  });
});

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

import { describe, expect, it } from "vitest";
import {
  TASK_CATEGORY_BADGE_LIGHTEN,
  taskCategoryBadgePalette,
  taskCategoryPalette,
} from "./category-colors";

describe("task category badge palette", () => {
  it("lightens the configured background while preserving readable contrast", () => {
    const category = { id: "billing", name: "Billing", color: "#ffab00" };
    const raw = taskCategoryPalette(category);
    const badge = taskCategoryBadgePalette(category);

    expect(badge.background).not.toBe(raw.background);
    expect(badge.background).toMatch(/^#[0-9a-f]{6}$/i);
    expect(badge.foreground).toBe("#172b4d");
    expect(TASK_CATEGORY_BADGE_LIGHTEN).toBe(0.72);
  });

  it("uses the same softened treatment for fallback colours", () => {
    const category = { id: "fallback", name: "Fallback", color: null };
    const raw = taskCategoryPalette(category);
    const badge = taskCategoryBadgePalette(category);

    expect(badge.background).not.toBe(raw.background);
    expect(badge.foreground).toMatch(/^#(?:172b4d|ffffff)$/);
  });
});

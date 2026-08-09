import { TASK_CATEGORY_COLORS } from "@/lib/tasks/category-colors";

export const DEFAULT_DROPDOWN_VALUE_COLOR = TASK_CATEGORY_COLORS[0];

function normalizeColor(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : null;
}

/**
 * Picks the least-used colour from the existing shared value palette.
 * Ties are stable so a group with no values always starts from the same colour.
 */
export function recommendDropdownValueColor(
  existingColors: readonly (string | null | undefined)[]
): string {
  const usage = new Map(
    TASK_CATEGORY_COLORS.map((color) => [color.toLowerCase(), 0])
  );

  for (const value of existingColors) {
    const normalized = normalizeColor(value);
    if (normalized && usage.has(normalized)) {
      usage.set(normalized, (usage.get(normalized) ?? 0) + 1);
    }
  }

  let recommended: string = DEFAULT_DROPDOWN_VALUE_COLOR;
  let lowestUsage = Number.POSITIVE_INFINITY;
  for (const color of TASK_CATEGORY_COLORS) {
    const count = usage.get(color.toLowerCase()) ?? 0;
    if (count < lowestUsage) {
      recommended = color;
      lowestUsage = count;
    }
  }
  return recommended;
}

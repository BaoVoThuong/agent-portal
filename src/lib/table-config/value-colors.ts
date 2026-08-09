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
function rankDropdownValueColors(
  existingColors: readonly (string | null | undefined)[]
): string[] {
  const usage = new Map(
    TASK_CATEGORY_COLORS.map((color) => [color.toLowerCase(), 0])
  );

  for (const value of existingColors) {
    const normalized = normalizeColor(value);
    if (normalized && usage.has(normalized)) {
      usage.set(normalized, (usage.get(normalized) ?? 0) + 1);
    }
  }

  return [...TASK_CATEGORY_COLORS].sort((left, right) => {
    const usageDifference =
      (usage.get(left.toLowerCase()) ?? 0) -
      (usage.get(right.toLowerCase()) ?? 0);
    if (usageDifference !== 0) return usageDifference;
    return TASK_CATEGORY_COLORS.indexOf(left) - TASK_CATEGORY_COLORS.indexOf(right);
  });
}

export function recommendDropdownValueColor(
  existingColors: readonly (string | null | undefined)[]
): string {
  return rankDropdownValueColors(existingColors)[0] ?? DEFAULT_DROPDOWN_VALUE_COLOR;
}

/** Returns the next recommendation without treating it as a custom colour. */
export function nextRecommendedDropdownValueColor(
  currentColor: string,
  existingColors: readonly (string | null | undefined)[]
): string {
  const ranked = rankDropdownValueColors(existingColors);
  const normalizedCurrent = normalizeColor(currentColor);
  const currentIndex = ranked.findIndex(
    (color) => color.toLowerCase() === normalizedCurrent
  );
  return ranked[(currentIndex + 1) % ranked.length] ?? DEFAULT_DROPDOWN_VALUE_COLOR;
}

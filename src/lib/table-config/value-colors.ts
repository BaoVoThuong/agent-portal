import {
  TASK_CATEGORY_COLORS,
  taskCategoryBadgePalette,
} from "@/lib/tasks/category-colors";

export const DEFAULT_DROPDOWN_VALUE_COLOR = TASK_CATEGORY_COLORS[0];

export const CONFIGURED_COLOR_ERROR =
  "Color must be a six-digit hex value such as #0c66e4.";

export type ConfiguredColorResult =
  | { ok: true; color: string | null }
  | { ok: false; error: string };

/**
 * Normalize one API color input without silently accepting malformed values.
 * Empty/null values intentionally clear a color; non-empty values must be a
 * six-digit hex color so every consumer can share the same stored format.
 */
export function parseConfiguredColor(value: unknown): ConfiguredColorResult {
  if (value === undefined || value === null) return { ok: true, color: null };
  if (typeof value !== "string") {
    return { ok: false, error: CONFIGURED_COLOR_ERROR };
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) return { ok: true, color: null };
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    return { ok: false, error: CONFIGURED_COLOR_ERROR };
  }
  return { ok: true, color: normalized };
}

export function normalizeConfiguredColor(value: unknown): string | null {
  const parsed = parseConfiguredColor(value);
  return parsed.ok ? parsed.color : null;
}

/**
 * The identity-badge palette for a custom dropdown option. Keeping this
 * wrapper beside the recommendation logic makes Config previews and the
 * shared CS/Enrollment cell renderer use the exact same fallback/hash rules.
 */
export function tableColumnOptionBadgePalette(option: {
  id: string;
  label: string;
  color: string | null | undefined;
}) {
  return taskCategoryBadgePalette({
    id: option.id,
    name: option.label,
    color: normalizeConfiguredColor(option.color),
  });
}

function normalizeColor(value: string | null | undefined): string | null {
  return normalizeConfiguredColor(value);
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

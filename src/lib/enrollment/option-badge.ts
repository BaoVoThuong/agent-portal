// Health CS uses two badge languages, and which one a column gets depends on
// what the value means:
//
//   Identity (CS: CategoryBadge)
//     softened value-colour background, contrast-computed foreground, and no
//     chevron.
//
//   Workflow state (CS: StatusPill)
//     pale tinted background, colour as foreground, and a chevron only when
//     the control is actionable. Enrollment's Stage uses this language.
import {
  lightenHexColor,
  readableTextColor,
  TASK_CATEGORY_BADGE_LIGHTEN,
} from "@/lib/tasks/category-colors";
import type { EnrollmentOption } from "./types";

/** Tint opacity for workflow-state badges (Stage). */
export const ENROLLMENT_STATE_BADGE_ALPHA = 0.14;

/** Keep identity badges readable without using the raw saturated colour. */
export const ENROLLMENT_IDENTITY_BADGE_LIGHTEN = TASK_CATEGORY_BADGE_LIGHTEN;

/** Neutral badge for no selected option or invalid stored colour. */
export const ENROLLMENT_BADGE_EMPTY = {
  bg: "#f4f5f7",
  fg: "#5e6c84",
} as const;

export function hexToRgba(hex: string, alpha: number): string | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  const [, red, green, blue] = match;
  return `rgba(${parseInt(red, 16)}, ${parseInt(green, 16)}, ${parseInt(blue, 16)}, ${alpha})`;
}

/** Identity badge: softened value colour with a readable foreground. */
export function enrollmentIdentityBadgeStyle(
  option: Pick<EnrollmentOption, "color"> | null
): { bg: string; fg: string } {
  if (!option?.color) return { ...ENROLLMENT_BADGE_EMPTY };
  if (!hexToRgba(option.color, 1)) return { ...ENROLLMENT_BADGE_EMPTY };
  const normalizedColor = option.color.startsWith("#")
    ? option.color
    : `#${option.color}`;
  const bg = lightenHexColor(normalizedColor, ENROLLMENT_IDENTITY_BADGE_LIGHTEN);
  return {
    bg,
    fg: readableTextColor(bg),
  };
}

/** Workflow-state badge: pale tint with the option colour as foreground. */
export function enrollmentStateBadgeStyle(
  option: Pick<EnrollmentOption, "color"> | null,
  alpha: number = ENROLLMENT_STATE_BADGE_ALPHA
): { bg: string; fg: string } {
  if (!option?.color) return { ...ENROLLMENT_BADGE_EMPTY };
  return {
    bg: hexToRgba(option.color, alpha) ?? "#dfe1e6",
    fg: option.color,
  };
}

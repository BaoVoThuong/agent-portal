import type { TaskCategory } from "./types";

export const TASK_CATEGORY_COLORS = [
  "#ffab00",
  "#ff7452",
  "#00b8d9",
  "#6554c0",
  "#36b37e",
  "#4c9aff",
  "#5e6c84",
] as const;

export function taskCategoryPalette(
  category: Pick<TaskCategory, "id" | "name" | "color">
) {
  if (category.color && isHexColor(category.color)) {
    return {
      background: category.color,
      foreground: readableTextColor(category.color),
    };
  }

  let hash = 0;
  for (const character of category.id || category.name) {
    hash = (hash + character.charCodeAt(0)) % TASK_CATEGORY_COLORS.length;
  }

  const background = TASK_CATEGORY_COLORS[hash];
  return {
    background,
    foreground: readableTextColor(background),
  };
}

/**
 * Category badges use a softer version of the configured colour so the list
 * stays easy to scan. Keep the raw palette above for configuration swatches
 * and option menus; only the rendered badge background is lightened here.
 */
export function taskCategoryBadgePalette(
  category: Pick<TaskCategory, "id" | "name" | "color">
) {
  const palette = taskCategoryPalette(category);
  const background = lightenHexColor(palette.background, 0.16);
  return {
    background,
    foreground: readableTextColor(background),
  };
}

export function lightenHexColor(hex: string, amount: number): string {
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const blend = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `#${[blend(red), blend(green), blend(blue)]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function readableTextColor(background: string): string {
  const red = Number.parseInt(background.slice(1, 3), 16);
  const green = Number.parseInt(background.slice(3, 5), 16);
  const blue = Number.parseInt(background.slice(5, 7), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.62 ? "#172b4d" : "#ffffff";
}

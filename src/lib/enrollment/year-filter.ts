import type { ColumnType } from "@/lib/table-config/types";

function normalizeYear(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value).trim();
  if (!text) return null;
  return /^\d{4}(?:\.0+)?$/.test(text) ? String(Number(text)) : text;
}

/**
 * The value saved for a custom dropdown is its option id, while the table shows
 * the option label. Filter by that same visible label so a Year dropdown never
 * exposes UUIDs or compares a selected label to a stored option id.
 */
export function resolveEnrollmentYearFilterValue(
  value: unknown,
  columnType: ColumnType | null | undefined,
  optionLabelById: ReadonlyMap<string, string> = new Map()
): string | null {
  const optionLabel =
    columnType === "dropdown" && value !== null && value !== undefined
      ? optionLabelById.get(String(value))
      : undefined;
  return normalizeYear(optionLabel ?? value);
}

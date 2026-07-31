import type { ColumnType } from "./types";

export type ValueAccessor<T> = (row: T, columnKey: string) => unknown;
export type ExcelFilterState = Map<string, Set<string>>;

const EMPTY_VALUE = "__table_config_empty__";
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function normalizeFilterValue(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? EMPTY_VALUE
    : String(value);
}

export function distinctColumnValues<T>(
  rows: T[],
  columnKey: string,
  accessor: ValueAccessor<T>,
  format: (value: unknown) => string
): { value: string; label: string }[] {
  const byValue = new Map<string, string>();
  for (const row of rows) {
    const raw = accessor(row, columnKey);
    const value = normalizeFilterValue(raw);
    if (!byValue.has(value)) {
      byValue.set(value, value === EMPTY_VALUE ? "(Blank)" : format(raw));
    }
  }
  return [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

export function applyExcelFilters<T>(
  rows: T[],
  filters: ExcelFilterState,
  accessor: ValueAccessor<T>
): T[] {
  if (filters.size === 0) return rows;
  return rows.filter((row) => {
    for (const [key, allowedValues] of filters) {
      if (allowedValues.size === 0) continue;
      if (!allowedValues.has(normalizeFilterValue(accessor(row, key)))) {
        return false;
      }
    }
    return true;
  });
}

export function compareByType(
  type: ColumnType,
  first: unknown,
  second: unknown
): number {
  const firstBlank = first === null || first === undefined || first === "";
  const secondBlank = second === null || second === undefined || second === "";
  if (firstBlank || secondBlank) {
    if (firstBlank && secondBlank) return 0;
    return firstBlank ? 1 : -1;
  }

  if (type === "number") {
    const a = Number(first);
    const b = Number(second);
    if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
  }
  if (type === "date") {
    const a = Date.parse(String(first));
    const b = Date.parse(String(second));
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a - b;
  }
  if (type === "checkbox") {
    return Number(Boolean(first)) - Number(Boolean(second));
  }
  return collator.compare(String(first), String(second));
}

export function sortByColumn<T>(
  rows: T[],
  columnKey: string,
  type: ColumnType,
  direction: "asc" | "desc",
  accessor: ValueAccessor<T>
): T[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort(
    (a, b) => multiplier * compareByType(type, accessor(a, columnKey), accessor(b, columnKey))
  );
}

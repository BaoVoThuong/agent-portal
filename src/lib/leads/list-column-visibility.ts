import type { TableColumn } from "@/lib/table-config/types";

// The identity of a row is never optional: opening a lead and reconciling a
// spreadsheet both depend on Key + Name staying on screen. This mirrors the
// Task List's locked Key/Client Name pair.
export const LEAD_LIST_LOCKED_COLUMN_KEYS = new Set(["key", "name"]);

export function toggleHiddenLeadListColumn(
  current: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(current);
  if (LEAD_LIST_LOCKED_COLUMN_KEYS.has(key)) return next;
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Global configuration wins first (`hidden_default`). The remaining columns
 * then honor the current user's table-settings popover, except identifiers and
 * admin-pinned columns that must remain in the list.
 */
export function visibleLeadListColumns(
  columns: readonly TableColumn[],
  hiddenKeys: ReadonlySet<string>,
): TableColumn[] {
  return columns.filter(
    (column) =>
      !column.hidden_default &&
      (LEAD_LIST_LOCKED_COLUMN_KEYS.has(column.key) ||
        column.pinned ||
        !hiddenKeys.has(column.key)),
  );
}

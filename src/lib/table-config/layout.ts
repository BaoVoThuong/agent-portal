import type { TableColumn } from "./types";
import { sortColumns } from "./columns";

export type LayoutEntry = {
  column_key: string;
  position: number;
  width: number | null;
  hidden: boolean;
};

export type ResolvedColumn = TableColumn & {
  width: number | null;
  hidden: boolean;
};

export function resolveLayout(
  columns: TableColumn[],
  layout: LayoutEntry[] | null
): ResolvedColumn[] {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const ordered: ResolvedColumn[] = [];
  const used = new Set<string>();

  for (const entry of [...(layout ?? [])].sort((a, b) => a.position - b.position)) {
    const column = byKey.get(entry.column_key);
    if (!column || used.has(column.key)) continue;
    ordered.push({
      ...column,
      width: entry.width,
      hidden: entry.hidden,
    });
    used.add(column.key);
  }

  for (const column of sortColumns(columns)) {
    if (used.has(column.key)) continue;
    ordered.push({
      ...column,
      width: null,
      hidden: column.hidden_default,
    });
  }

  return ordered;
}

export function serializeLayout(columns: ResolvedColumn[]): LayoutEntry[] {
  return columns.map((column, index) => ({
    column_key: column.key,
    position: index,
    width: column.width,
    hidden: column.hidden,
  }));
}

export function applyLayoutChange(
  columns: ResolvedColumn[],
  change:
    | { key: string; width?: number | null; hidden?: boolean }
    | { reorder: string[] }
): ResolvedColumn[] {
  if ("reorder" in change) {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const next: ResolvedColumn[] = [];
    const used = new Set<string>();
    for (const key of change.reorder) {
      const column = byKey.get(key);
      if (!column || used.has(key)) continue;
      next.push(column);
      used.add(key);
    }
    for (const column of columns) {
      if (!used.has(column.key)) next.push(column);
    }
    return next;
  }

  return columns.map((column) =>
    column.key === change.key
      ? {
          ...column,
          width: "width" in change ? change.width ?? null : column.width,
          hidden: change.hidden ?? column.hidden,
        }
      : column
  );
}

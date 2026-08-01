import type { TableColumn } from "./types";

export type EditableColumnField =
  | "label"
  | "type"
  | "position"
  | "pinned"
  | "hidden_default"
  | "show_in_detail"
  | "required"
  | "archived_at";

export function slugifyColumnKey(label: string): string {
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "custom_column";
}

export function sortColumns<T extends Pick<TableColumn, "position" | "label" | "key">>(
  columns: readonly T[]
): T[] {
  return [...columns].sort(
    (a, b) =>
      a.position - b.position ||
      a.label.localeCompare(b.label) ||
      a.key.localeCompare(b.key)
  );
}

export function canEditColumnField(
  column: Pick<TableColumn, "is_system">,
  field: EditableColumnField
): boolean {
  if (!column.is_system) return true;
  return (
    field === "label" ||
    field === "position" ||
    field === "pinned" ||
    field === "hidden_default" ||
    field === "show_in_detail"
  );
}

export function nextPosition(columns: readonly Pick<TableColumn, "position">[]): number {
  if (columns.length === 0) return 10;
  return Math.max(...columns.map((column) => column.position)) + 10;
}

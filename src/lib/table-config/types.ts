export const TABLE_SCOPES = [
  "cs",
  "aca",
  "medicare",
  "lead_pc",
  "lead_health",
] as const;
export type TableScope = (typeof TABLE_SCOPES)[number];

export const COLUMN_TYPES = [
  "text",
  "number",
  "dropdown",
  "date",
  "checkbox",
  "link",
  "person",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export type TableColumn = {
  id: string;
  scope: TableScope;
  key: string;
  label: string;
  type: ColumnType;
  is_system: boolean;
  position: number;
  pinned: boolean;
  hidden_default: boolean;
  show_in_detail: boolean;
  required: boolean;
  created_by_email?: string | null;
  created_at?: string;
  updated_at?: string;
  archived_at: string | null;
};

export type TableColumnOption = {
  id: string;
  column_id: string;
  label: string;
  color: string | null;
  position: number;
  created_at?: string;
  updated_at?: string;
  archived_at: string | null;
};

export function isTableScope(value: unknown): value is TableScope {
  return (
    typeof value === "string" &&
    (TABLE_SCOPES as readonly string[]).includes(value)
  );
}

export function parseTableScope(value: unknown): TableScope | null {
  return isTableScope(value) ? value : null;
}

export function toTableScope(value: unknown): TableScope {
  return isTableScope(value) ? value : "cs";
}

export function isColumnType(value: unknown): value is ColumnType {
  return (
    typeof value === "string" &&
    (COLUMN_TYPES as readonly string[]).includes(value)
  );
}

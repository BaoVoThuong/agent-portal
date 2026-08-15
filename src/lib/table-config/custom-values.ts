import type { ColumnType, TableColumn, TableColumnOption } from "./types";

export type CustomValueRecord = Record<string, unknown>;

export type CustomValueIssue = {
  key: string;
  label?: string;
  reason:
    | "invalid-record"
    | "unknown-column"
    | "system-column"
    | "archived-column"
    | "invalid-type"
    | "invalid-option"
    | "invalid-person";
};

export type WriteValidationContext = {
  columns: TableColumn[];
  options: TableColumnOption[];
  matchedPersonEmails: string[];
};

export type ValidateCustomValuesResult =
  | { ok: true; values: CustomValueRecord }
  | { ok: false; issues: CustomValueIssue[] };

/** JSON objects only; arrays, null and primitives are not custom-value maps. */
export function isCustomValueRecord(value: unknown): value is CustomValueRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValueValidForType(type: ColumnType, value: unknown): boolean {
  if (value === null) return true;
  switch (type) {
    case "text":
    case "link":
    case "date":
    case "person":
    case "dropdown":
      return typeof value === "string";
    case "number":
      return isFiniteNumber(value);
    case "checkbox":
      return typeof value === "boolean";
    default:
      return false;
  }
}

/** Validates only the supplied delta; Required semantics stay separate. */
export function validateCustomValues(
  submitted: unknown,
  context: WriteValidationContext
): ValidateCustomValuesResult {
  if (!isCustomValueRecord(submitted)) {
    return { ok: false, issues: [{ key: "custom_values", reason: "invalid-record" }] };
  }

  const columnsByKey = new Map(context.columns.map((column) => [column.key, column]));
  const optionsByColumn = new Map<string, Set<string>>();
  for (const option of context.options) {
    const values = optionsByColumn.get(option.column_id) ?? new Set<string>();
    values.add(option.id);
    optionsByColumn.set(option.column_id, values);
  }
  const matchedPeople = new Set(
    context.matchedPersonEmails.map((email) => email.trim().toLowerCase())
  );
  const issues: CustomValueIssue[] = [];
  const values: CustomValueRecord = {};

  for (const [key, value] of Object.entries(submitted)) {
    const column = columnsByKey.get(key);
    if (!column) {
      issues.push({ key, reason: "unknown-column" });
      continue;
    }
    if (column.is_system) {
      issues.push({ key, label: column.label, reason: "system-column" });
      continue;
    }
    if (column.archived_at) {
      issues.push({ key, label: column.label, reason: "archived-column" });
      continue;
    }
    if (!isValueValidForType(column.type, value)) {
      issues.push({ key, label: column.label, reason: "invalid-type" });
      continue;
    }
    if (value !== null && column.type === "dropdown") {
      const optionIds = optionsByColumn.get(column.id);
      if (!optionIds?.has(value as string)) {
        issues.push({ key, label: column.label, reason: "invalid-option" });
        continue;
      }
    }
    if (value !== null && column.type === "person") {
      const normalized = (value as string).trim().toLowerCase();
      if (!normalized || !matchedPeople.has(normalized)) {
        issues.push({ key, label: column.label, reason: "invalid-person" });
        continue;
      }
    }
    values[key] = value;
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, values };
}

export function customValueIssuesMessage(issues: readonly CustomValueIssue[]): string {
  const labels = [...new Set(issues.map((issue) => issue.label || issue.key))];
  return labels.length > 0
    ? `Invalid custom value: ${labels.join(", ")}.`
    : "Invalid custom values.";
}

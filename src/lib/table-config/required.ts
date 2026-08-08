import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTableColumns } from "./queries";
import type { ColumnType, TableScope } from "./types";

export function isRequiredValueFilled(type: ColumnType, value: unknown): boolean {
  // A checkbox's `false` value is a deliberate answer and therefore counts as
  // filled. Null/undefined/empty values are still missing, which matters for
  // ACA Consent: it is rendered as a checkbox but stored as a nullable option
  // id, so the server must agree with the form's Required check.
  if (type === "checkbox") {
    return value !== null && value !== undefined && value !== "";
  }
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim() !== "";
  return Boolean(value);
}

export type MissingRequiredField = { key: string; label: string };

/**
 * Finds required columns (table_column.required = true) whose value is
 * missing from the given payload.
 *
 * - `partial: false` (create/POST): every required column is checked,
 *   whether or not the caller's payload mentions it — an omitted required
 *   field is exactly as invalid as an explicit empty one.
 * - `partial: true` (update/PATCH): only required columns whose field is
 *   actually present in `fieldValues`/`customValues` are checked — a PATCH
 *   that never touches a required field must not be blocked by it.
 *
 * `checkCustom` (default true) lets a caller skip custom-column validation
 * entirely — needed for surfaces (e.g. Enrollment's Create dialog) that have
 * no UI to set custom_values at all, where validating them at creation time
 * would make a Required custom column permanently unsatisfiable.
 *
 * `fieldValues` is keyed by table_column.key DIRECTLY — the exact same key
 * this function reads off each live row from fetchTableColumns() below.
 * There is no separate translation table anywhere mapping column keys to
 * request/DB field names: the caller names its object properties after the
 * column keys itself (e.g. `{ summary: title, category: categoryId }`), so
 * there is nothing that can drift out of sync with what's actually in the
 * table_column table — the set of columns actually checked is 100% whatever
 * fetchTableColumns() returns as required=true right now, not a hardcoded
 * list maintained in source.
 */
export async function findMissingRequiredFields(
  scope: TableScope,
  options: {
    fieldValues: Record<string, unknown>;
    customValues?: Record<string, unknown> | null;
    partial?: boolean;
    checkCustom?: boolean;
  },
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<MissingRequiredField[]> {
  const columns = await fetchTableColumns(scope, supabase);
  const missing: MissingRequiredField[] = [];

  for (const column of columns) {
    if (!column.required || column.archived_at) continue;

    if (column.is_system) {
      if (options.partial && !(column.key in options.fieldValues)) continue;
      if (!isRequiredValueFilled(column.type, options.fieldValues[column.key])) {
        missing.push({ key: column.key, label: column.label });
      }
      continue;
    }

    if (options.checkCustom === false) continue;
    const customValues = options.customValues ?? {};
    if (options.partial && !(column.key in customValues)) continue;
    if (!isRequiredValueFilled(column.type, customValues[column.key])) {
      missing.push({ key: column.key, label: column.label });
    }
  }

  return missing;
}

export function missingRequiredFieldsMessage(missing: MissingRequiredField[]): string {
  return `${missing.map((field) => field.label).join(", ")} required.`;
}

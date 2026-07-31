import type { TableColumn } from "./types";
import { coerceCustomValue, type CustomValueContext } from "./values";

export type ImportClassifiedRow = {
  action: "add" | "update" | "error";
  targetRecordId: string | null;
  values: Record<string, unknown>;
  errors: string[];
};

export type ImportSummary = {
  addCount: number;
  updateCount: number;
  errorCount: number;
};

export function classifyImportRows(
  rows: Record<string, unknown>[],
  columns: TableColumn[],
  matchColumnKey: string,
  existingByMatchValue: Map<string, string>,
  ctxByColumnKey: Record<string, CustomValueContext> = {}
): { rows: ImportClassifiedRow[]; summary: ImportSummary } {
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const matchColumn = columnByKey.get(matchColumnKey);
  const classified = rows.map((row) => {
    const values: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const [key, raw] of Object.entries(row)) {
      const column = columnByKey.get(key);
      if (!column) continue;
      const coerced = coerceCustomValue(column.type, raw, ctxByColumnKey[key]);
      if (coerced.ok) {
        values[key] = coerced.value;
      } else {
        errors.push(`${column.label}: ${coerced.error}`);
      }
    }

    if (!matchColumn) {
      errors.push("Match column is invalid.");
    }
    const matchValue = normalizeMatchValue(values[matchColumnKey]);
    if (!matchValue) {
      errors.push(`${matchColumn?.label ?? matchColumnKey}: match value is required.`);
    }

    if (errors.length > 0) {
      return { action: "error", targetRecordId: null, values, errors } satisfies ImportClassifiedRow;
    }
    const targetRecordId = existingByMatchValue.get(matchValue) ?? null;
    return {
      action: targetRecordId ? "update" : "add",
      targetRecordId,
      values,
      errors,
    } satisfies ImportClassifiedRow;
  });

  return {
    rows: classified,
    summary: {
      addCount: classified.filter((row) => row.action === "add").length,
      updateCount: classified.filter((row) => row.action === "update").length,
      errorCount: classified.filter((row) => row.action === "error").length,
    },
  };
}

export function canApproveImport(
  request: { submitted_by_email: string; status: string },
  reviewerEmail: string
): { ok: true } | { ok: false; error: string } {
  if (request.status !== "pending") {
    return { ok: false, error: "Import request is not pending." };
  }
  if (
    request.submitted_by_email.trim().toLowerCase() ===
    reviewerEmail.trim().toLowerCase()
  ) {
    return { ok: false, error: "A different admin must approve this import." };
  }
  return { ok: true };
}

export function normalizeMatchValue(value: unknown): string {
  return value === null || value === undefined
    ? ""
    : String(value).trim().toLowerCase();
}

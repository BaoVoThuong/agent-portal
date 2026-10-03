import { parseMultiselectValue } from "@/lib/table-config/multiselect";
import { storesInCustomValues } from "@/lib/table-config/system-option-columns";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { coerceCustomValue } from "@/lib/table-config/values";
import {
  cellText,
  LEAD_IMPORT_CUSTOM_FIELDS,
  type TemplateLead,
} from "./import-template";

/**
 * Sáu cột custom của mẫu Import → giá trị `custom_values` lưu được.
 *
 * File chứa NHÃN ("Female", "AM, PM"), còn `validateCustomValues` chỉ nhận
 * OPTION ID. Import cũ không đổi nên mọi dòng có cột lựa chọn đều bị loại
 * vì "invalid option". Ở đây đổi nhãn → id, so không phân biệt hoa thường.
 */

function labelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function choiceLabels(column: TableColumn, raw: unknown): string[] {
  if (column.type === "multiselect") return parseMultiselectValue(cellText(raw) ?? "");
  const text = cellText(raw);
  return text ? [text] : [];
}

/** Cột của mẫu Import đang hoạt động trong Table Config, theo key. */
export function activeImportColumns(
  columns: readonly TableColumn[],
): Map<string, TableColumn> {
  const keys = new Set<string>(LEAD_IMPORT_CUSTOM_FIELDS);
  return new Map(
    columns
      // Sáu trường này là cột HỆ THỐNG lưu trong custom_values (2026-10-03).
      .filter((column) => storesInCustomValues(column) && !column.archived_at && keys.has(column.key))
      .map((column) => [column.key, column]),
  );
}

export type MissingChoiceLabels = { column: TableColumn; labels: string[] }[];

/**
 * Nhãn trong file mà cột lựa chọn chưa có — Import sẽ TẠO chúng ("có gì ghi
 * nấy"), không bỏ. Giữ cách viết của lần xuất hiện đầu tiên.
 */
export function findMissingChoiceLabels(
  rows: readonly TemplateLead[],
  columns: readonly TableColumn[],
  options: readonly TableColumnOption[],
): MissingChoiceLabels {
  const result: MissingChoiceLabels = [];
  for (const column of activeImportColumns(columns).values()) {
    if (column.type !== "dropdown" && column.type !== "multiselect") continue;
    const known = new Set(
      options
        .filter((option) => option.column_id === column.id && !option.archived_at)
        .map((option) => labelKey(option.label)),
    );
    const missing = new Map<string, string>();
    for (const row of rows) {
      const raw = row.customRaw[column.key as keyof TemplateLead["customRaw"]];
      for (const label of choiceLabels(column, raw)) {
        const key = labelKey(label);
        if (!known.has(key) && !missing.has(key)) missing.set(key, label.trim());
      }
    }
    if (missing.size > 0) result.push({ column, labels: [...missing.values()] });
  }
  return result;
}

/**
 * Giá trị thô của một dòng → `custom_values`. Cột không có trong Table Config
 * thì bỏ qua (route báo là "ignored"). Giá trị không đổi được — vd. Age là
 * chữ — thì bỏ riêng ô đó và trả lý do, dòng vẫn import.
 */
export function toImportCustomValues(
  row: TemplateLead,
  columns: readonly TableColumn[],
  options: readonly TableColumnOption[],
): { values: Record<string, unknown>; warnings: string[] } {
  const values: Record<string, unknown> = {};
  const warnings: string[] = [];
  for (const [key, column] of activeImportColumns(columns)) {
    const raw = row.customRaw[key as keyof TemplateLead["customRaw"]];
    if (raw === undefined || raw === null) continue;

    if (column.type === "dropdown" || column.type === "multiselect") {
      const idByLabel = new Map(
        options
          .filter((option) => option.column_id === column.id && !option.archived_at)
          .map((option) => [labelKey(option.label), option.id]),
      );
      const ids: string[] = [];
      for (const label of choiceLabels(column, raw)) {
        const id = idByLabel.get(labelKey(label));
        if (id) {
          if (!ids.includes(id)) ids.push(id);
        } else {
          warnings.push(`${column.label}: "${label}" is not an option`);
        }
      }
      if (ids.length === 0) continue;
      values[key] = column.type === "dropdown" ? ids[0] : ids;
      continue;
    }

    const coerced = coerceCustomValue(column.type, raw);
    if (!coerced.ok) {
      warnings.push(`${column.label}: "${cellText(raw) ?? ""}" — ${coerced.error}`);
      continue;
    }
    if (coerced.value !== null) values[key] = coerced.value;
  }
  return { values, warnings };
}

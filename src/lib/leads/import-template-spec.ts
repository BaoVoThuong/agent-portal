import {
  distinctLabels,
  personChoiceLabels,
  type ImportTemplateSpec,
  type TemplateDropdown,
} from "@/lib/import-template/spec";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { activeImportColumns } from "./import-custom-values";
import {
  LEAD_IMPORT_CUSTOM_FIELDS,
  LEAD_IMPORT_TEMPLATE,
  normalizePersonName,
  type TemplateField,
} from "./import-template";

/** Trần số dòng của route Import Lead — dropdown phủ đúng ngần ấy dòng. */
export const LEAD_IMPORT_MAX_ROWS = 2000;

/**
 * File mẫu Lead có dropdown. Tiêu đề giữ đúng mẫu cố định của Google Sheet đội
 * gửi lead (`LEAD_IMPORT_TEMPLATE`); dropdown lấy nhãn hiện tại trong Table
 * Config. Import TỰ TẠO nhãn chưa có ("có gì ghi nấy"), nên các cột lựa chọn
 * chỉ cảnh báo chứ không chặn. Cột Agent: tên Agent, tên trùng thì email.
 */
export function buildLeadTemplateSpec(
  columns: readonly TableColumn[],
  columnOptions: readonly TableColumnOption[],
  agents: readonly { email: string; name?: string | null }[],
): ImportTemplateSpec {
  const active = activeImportColumns(columns);
  const customFields = new Set<string>(LEAD_IMPORT_CUSTOM_FIELDS);
  const agentLabels = personChoiceLabels(agents, normalizePersonName);

  const dropdownFor = (field: TemplateField): TemplateDropdown | undefined => {
    if (field === "agent") {
      return agentLabels.length > 0
        ? { values: agentLabels, allowOther: false, tracked: false }
        : undefined;
    }
    if (!customFields.has(field)) return undefined;
    const column = active.get(field);
    if (!column || (column.type !== "dropdown" && column.type !== "multiselect")) {
      return undefined;
    }
    const values = distinctLabels(
      columnOptions
        .filter((option) => option.column_id === column.id && !option.archived_at)
        .sort((a, b) => a.position - b.position)
        .map((option) => option.label),
    );
    return values.length > 0 ? { values, allowOther: true } : undefined;
  };

  return {
    kind: "lead",
    rows: LEAD_IMPORT_MAX_ROWS,
    columns: LEAD_IMPORT_TEMPLATE.map((column) => ({
      header: column.header,
      dropdown: dropdownFor(column.field),
    })),
  };
}

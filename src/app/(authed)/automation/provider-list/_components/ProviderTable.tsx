"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { EditableCustomCell } from "../../../_shared/EditableCustomCell";
import {
  PROVIDER_META_FIELDS,
  PROVIDER_TEXT_FIELDS,
  isPortalRow,
  type ProviderMetaField,
  type ProviderRow,
} from "@/lib/providers/types";
import type { ProviderSortDir } from "@/lib/providers/search";

const DEFAULT_COLUMN_WIDTH = 160;
const COLUMN_WIDTHS: Record<string, number> = {
  doctors: 200,
  facility: 240,
  npi: 130,
  practices_as: 170,
  phone: 140,
  street: 200,
  city: 140,
  state: 80,
  zip_code: 100,
  accepting_new_patients: 180,
  source: 100,
  business_hours: 220,
  // Giá trị dạng "Oscar HMO, Ambetter EPO, CHC Premier" — cắt ngắn là mất đúng
  // phần người đọc cần.
  obamacare: 280,
  medicare: 280,
  other_plans: 220,
  verified_by: 140,
  date: 130,
  created_at: 150,
  created_by_email: 170,
  updated_at: 150,
  updated_by_email: 170,
  synced_at: 150,
};

function columnWidth(column: TableColumn): number {
  return COLUMN_WIDTHS[column.key] ?? DEFAULT_COLUMN_WIDTH;
}

/** `source` là cột dẫn xuất, không nằm trong database và không sửa được. */
function isSourceColumn(column: TableColumn): boolean {
  return column.is_system && column.key === "source";
}

/** Cột siêu dữ liệu: do hệ thống ghi, người dùng chỉ đọc. */
function isMetaColumn(column: TableColumn): boolean {
  return (
    column.is_system && (PROVIDER_META_FIELDS as readonly string[]).includes(column.key)
  );
}

function formatMetaValue(value: string | null, type: TableColumn["type"]): string {
  if (!value) return "—";
  if (type !== "date") return value;
  const date = new Date(value);
  // Dữ liệu cũ có thể mang chuỗi không phải ngày; in nguyên văn còn hơn hiện
  // "Invalid Date".
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isEditableTextColumn(column: TableColumn): boolean {
  return (
    column.is_system && (PROVIDER_TEXT_FIELDS as readonly string[]).includes(column.key)
  );
}

export function ProviderTable({
  providers,
  columns,
  columnOptions,
  sortKey,
  sortDir,
  onSort,
  onPatch,
}: {
  providers: ProviderRow[];
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
  sortKey: string | null;
  sortDir: ProviderSortDir;
  onSort: (key: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const minWidth = columns.reduce((total, column) => total + columnWidth(column), 0);

  if (providers.length === 0) {
    return (
      <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
        No providers match the current search.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth }}>
          <div className="sticky top-0 z-20 flex items-stretch whitespace-nowrap border-b border-[#dfe1e6] bg-[#fafbfc] text-[11px] font-bold uppercase tracking-wide text-[#6b778c] shadow-[0_1px_0_#dfe1e6]">
            {columns.map((column) => {
              const active = sortKey === column.key;
              return (
                <div
                  key={column.id}
                  style={{ width: columnWidth(column) }}
                  className="flex shrink-0 items-center px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => onSort(column.key)}
                    aria-label={
                      active
                        ? `${column.label}, sorted ${sortDir === "asc" ? "ascending" : "descending"}`
                        : `Sort by ${column.label}`
                    }
                    className={`group flex min-w-0 items-center gap-1 rounded text-left uppercase transition hover:text-[#0c66e4] ${
                      active ? "text-[#0c66e4]" : ""
                    }`}
                  >
                    <span className="truncate">{column.label}</span>
                    {active ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3 shrink-0" />
                      ) : (
                        <ArrowDown className="h-3 w-3 shrink-0" />
                      )
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>

          <ul>
            {providers.map((provider) => (
              <li
                key={provider.id}
                className="group flex items-stretch border-b border-[#f0f1f4] hover:bg-[#f7f8f9]"
              >
                {columns.map((column) => (
                  <div
                    key={column.id}
                    style={{ width: columnWidth(column) }}
                    className="flex shrink-0 items-center px-3 py-1.5"
                  >
                    <ProviderCell
                      provider={provider}
                      column={column}
                      options={columnOptions.filter(
                        (option) => option.column_id === column.id
                      )}
                      onPatch={(patch) => onPatch(provider.id, patch)}
                    />
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ProviderCell({
  provider,
  column,
  options,
  onPatch,
}: {
  provider: ProviderRow;
  column: TableColumn;
  options: TableColumnOption[];
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
}) {
  if (isSourceColumn(column)) {
    const manual = isPortalRow(provider);
    return (
      <span
        title={
          manual
            ? "Added in the portal. The Google Sheet sync never touches this row."
            : "Came from the Google Sheet. The nightly sync replaces this row."
        }
        className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold ${
          manual ? "bg-[#e3fcef] text-[#006644]" : "bg-[#eef2f8] text-[#5e6c84]"
        }`}
      >
        {manual ? "Manual" : "Sheet"}
      </span>
    );
  }

  if (isMetaColumn(column)) {
    const text = formatMetaValue(
      provider[column.key as ProviderMetaField],
      column.type
    );
    return (
      <span className="truncate text-sm font-medium text-[#5e6c84]" title={text}>
        {text}
      </span>
    );
  }

  // Cột hệ thống còn lại của provider đều là cột văn bản có thật trong bảng,
  // nên sửa thẳng bằng chính component mà Task List và Event Leads dùng — cùng
  // một lối bấm-để-sửa, không phải học lại.
  if (isEditableTextColumn(column)) {
    return (
      <EditableCustomCell
        column={column}
        value={provider[column.key as (typeof PROVIDER_TEXT_FIELDS)[number]]}
        canEdit
        onSave={(next) => onPatch({ [column.key]: next })}
        className="w-full"
      />
    );
  }

  if (!column.is_system) {
    return (
      <EditableCustomCell
        column={column}
        value={provider.custom_values?.[column.key]}
        options={options}
        canEdit
        onSave={(next) => onPatch({ custom_values: { [column.key]: next } })}
        className={column.type === "checkbox" ? "" : "w-full"}
      />
    );
  }

  return <span className="truncate text-sm text-[#97a0af]">—</span>;
}

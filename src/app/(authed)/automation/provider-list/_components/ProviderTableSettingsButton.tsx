"use client";

import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import type { TableColumn } from "@/lib/table-config/types";
import { PROVIDER_LIST_LOCKED_COLUMN_KEYS } from "@/lib/providers/list-columns";
import { useAnchoredMenu } from "../../../tasks/_components/use-anchored-menu";

/** Bộ chọn cột theo từng người, giống hệt Task List và Event Leads. */
export function ProviderTableSettingsButton({
  columns,
  hiddenColumnKeys,
  onToggleColumn,
}: {
  columns: readonly TableColumn[];
  hiddenColumnKeys: ReadonlySet<string>;
  onToggleColumn: (key: string) => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle } = useAnchoredMenu();
  // Khác Task List và Event Leads: ở đây `hidden_default` KHÔNG bị loại khỏi
  // menu. Bảng provider có những cột thưa dữ liệu nên mặc định ẩn (Other plans,
  // Verified by, ngày xác minh, nhóm siêu dữ liệu) — nếu menu cũng không bật
  // lại được thì người cần tới chúng bế tắc, phải nhờ admin vào /config. Cột
  // định danh và cột admin ghim vẫn không tắt được.
  const toggleableColumns = columns.filter(
    (column) => !column.pinned && !PROVIDER_LIST_LOCKED_COLUMN_KEYS.has(column.key)
  );
  const hiddenCount = toggleableColumns.filter((column) =>
    hiddenColumnKeys.has(column.key)
  ).length;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        title="Table settings"
        aria-label={
          hiddenCount > 0
            ? `Table settings, ${hiddenCount} hidden columns`
            : "Table settings"
        }
        aria-expanded={isOpen}
        className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-white text-[#44546f] shadow-[0_1px_3px_rgba(22,35,58,0.12)] transition hover:border-[#b8c5d6] hover:bg-[#f8fafc] hover:text-[#172b4d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#deebff] ${
          isOpen ? "border-[#0c66e4] text-[#0c66e4]" : "border-[#dfe1e6]"
        }`}
      >
        <Settings2 className="h-[18px] w-[18px]" />
        {hiddenCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#deebff] px-1 text-[10px] font-bold leading-none text-[#0c66e4] ring-2 ring-white">
            {hiddenCount}
          </span>
        ) : null}
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="dashboard-filter-menu z-[110] flex max-h-[calc(100vh-6rem)] w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden p-2"
            >
              <div className="border-b border-[#ebecf0] px-2 py-2">
                <div className="flex items-center gap-2 text-sm font-bold text-[#172b4d]">
                  <Settings2 className="h-4 w-4 text-[#0c66e4]" />
                  Table settings
                </div>
                <div className="mt-1 text-[11px] font-medium text-[#6b778c]">
                  Choose which table columns are visible.
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto py-1">
                {toggleableColumns.map((column) => {
                  const checked = !hiddenColumnKeys.has(column.key);
                  return (
                    <label
                      key={column.key}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-semibold text-[#172b4d] transition hover:bg-[#f4f5f7]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleColumn(column.key)}
                        className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]"
                      />
                      <span className="min-w-0 truncate">{column.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

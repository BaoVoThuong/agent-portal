"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";
import {
  blankProviderValues,
  isReadOnlyProviderColumn,
  providerFormPayload,
} from "@/lib/providers/form";
import { ProviderFormBody } from "./ProviderFormFields";

function isFilled(value: unknown, type?: TableColumn["type"]): boolean {
  if (type === "checkbox") return value !== null && value !== undefined && value !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

export function AddProviderDialog({
  open,
  columns,
  columnOptions,
  viewerName,
  onClose,
  onCreate,
}: {
  open: boolean;
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
  /** Tên người đang đăng nhập — điền sẵn vào Verified by cho dòng gõ tay. */
  viewerName: string;
  onClose: () => void;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
}) {
  // `key` ở nơi gọi dựng lại component mỗi lần mở, nên khởi tạo một lần là đủ —
  // không cần vòng reset thủ công sau khi lưu.
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    blankProviderValues(columns, viewerName)
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editableColumns = columns.filter(
    (column) => !column.archived_at && !isReadOnlyProviderColumn(column)
  );

  useBodyScrollLock(open);
  if (!open) return null;

  async function submit() {
    // Cùng luật với server: một dòng không có cả tên bác sĩ lẫn tên cơ sở thì
    // không ai tra cứu được. Kiểm ở đây để người dùng biết ngay, không phải
    // chờ một vòng gọi API mới thấy lỗi.
    if (!String(values.doctors ?? "").trim() && !String(values.facility ?? "").trim()) {
      setError("Doctor or facility is required.");
      return;
    }
    // Cột Required do admin đặt trong /config — form phải đánh dấu đúng những
    // cột mà server sẽ từ chối, nếu không người dùng bị chặn vì một ô mà màn
    // hình không hề nói là bắt buộc.
    const missing = editableColumns
      .filter((column) => column.required)
      .filter((column) => !isFilled(values[column.key], column.type));
    if (missing.length > 0) {
      setError(`${missing.map((column) => column.label).join(", ")} required.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onCreate(providerFormPayload(values, editableColumns));
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not add the provider."
      );
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-[#091e42]/60 p-3 backdrop-blur-[2px] sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add address"
        className="flex h-[calc(100dvh-5rem)] max-h-[760px] w-full max-w-[1160px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-[#dfe1e6] px-4 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-sm font-bold text-[#97a0af]">
              Provider
            </span>
            <span className="shrink-0 rounded-full bg-[#e6f6ed] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#216e4e]">
              New
            </span>
            <span className="shrink-0 text-[#c1c7d0]">·</span>
            <h2 className="min-w-0 truncate text-base font-bold text-[#172b4d] sm:text-lg">
              Add address
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-[#42526e] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 py-4 sm:px-5">
          <ProviderFormBody
            columns={columns}
            columnOptions={columnOptions}
            values={values}
            viewerName={viewerName}
            showSystemInfo={false}
            onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
          />
          {error ? (
            <p className="mx-auto mt-3 max-w-[1120px] rounded-xl border border-[#ffbdad] bg-[#ffebe6] px-4 py-3 text-sm font-semibold text-[#bf2600]">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[#dfe1e6] bg-white px-4 py-2.5 sm:px-5">
          <p className="hidden text-xs text-[#7a869a] sm:block">
            Rows added here are kept in the portal. The nightly Google Sheet sync never
            replaces them.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded px-3 py-2 text-sm font-bold text-[#42526e] transition hover:bg-[#f2f4f7]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="rounded-lg bg-[#0c66e4] px-4 py-2 text-sm font-bold text-white shadow-[0_2px_5px_rgba(9,30,66,0.16)] transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Adding…" : "Add address"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}

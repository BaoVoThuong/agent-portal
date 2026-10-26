"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";
import {
  blankProviderValues,
  isReadOnlyProviderColumn,
  providerFormPayload,
  verifiedStampValues,
} from "@/lib/providers/form";
import { ProviderFormBody } from "./ProviderFormFields";

function isFilled(value: unknown, type?: TableColumn["type"]): boolean {
  if (type === "checkbox") return value !== null && value !== undefined && value !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

/** Dialog thêm provider — cùng form và cùng kiểu gọn A1 với dialog sửa, không có cột comment. */
export function AddProviderDialog({
  open,
  columns,
  columnOptions,
  viewerName,
  people,
  goesToBacklog = false,
  onClose,
  onCreate,
}: {
  open: boolean;
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
  /** Tên người đang đăng nhập — điền sẵn vào Verified by cho dòng gõ tay. */
  viewerName: string;
  /** Người xem được Provider List — avatar cho ô Verified by. */
  people: readonly TaskAssignee[];
  /** Người không có Provider List - Manage: dòng vào Backlog chờ duyệt. */
  goesToBacklog?: boolean;
  onClose: () => void;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
}) {
  // `key` ở nơi gọi dựng lại component mỗi lần mở, nên khởi tạo một lần là đủ —
  // không cần vòng reset thủ công sau khi lưu.
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    {
      const initial = blankProviderValues(columns, viewerName);
      if (goesToBacklog) {
        initial.needs_review = false;
        initial.verified_by = "";
        initial.date = "";
      }
      return initial;
    }
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
      className="fixed inset-0 z-[180] flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add address"
        className="flex max-h-[calc(100dvh-3rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]"
      >
        {/* Cùng khung với dialog New enrollment: header tiêu đề 20px, thân đệm 24px,
            footer nút 36px — user 26/10: các dialog trong app phải cùng một kiểu. */}
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <h2 className="min-w-0 truncate text-xl font-semibold text-[#172b4d]">Add address</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-5">
          <ProviderFormBody
            columns={columns}
            columnOptions={columnOptions}
            values={values}
            viewerName={viewerName}
            people={people}
            showSystemInfo={false}
            hideReview={goesToBacklog}
            // Dòng mới: bỏ tick Reviewed nghĩa là chưa ai soát, nên để trống.
            unreviewedValues={verifiedStampValues(values, { blank: true })}
            onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
          />
          {error ? (
            <p className="mt-4 rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-semibold text-[#bf2600]">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#dfe1e6] bg-white px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-9 items-center rounded px-4 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="inline-flex h-9 items-center rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving
              ? goesToBacklog ? "Sending…" : "Adding…"
              : goesToBacklog ? "Send for review" : "Add address"}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

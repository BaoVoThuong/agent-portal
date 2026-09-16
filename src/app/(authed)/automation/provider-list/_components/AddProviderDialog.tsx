"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { PROVIDER_TEXT_FIELDS, type ProviderTextField } from "@/lib/providers/types";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";

const INPUT_CLASS =
  "h-10 w-full rounded border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#172b4d] outline-none transition focus:border-[#0c66e4]";
const LABEL_CLASS = "text-xs font-bold uppercase tracking-[0.06em] text-[#667085]";

function isFilled(value: unknown, type?: TableColumn["type"]): boolean {
  if (type === "checkbox") return value !== null && value !== undefined && value !== "";
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

function CustomProviderField({
  column,
  options,
  value,
  onChange,
}: {
  column: TableColumn;
  options: TableColumnOption[];
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (column.type === "checkbox") {
    return (
      <label className="flex h-10 items-center gap-2 rounded border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#344054]">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]"
        />
        {column.label}
      </label>
    );
  }

  if (column.type === "dropdown") {
    return (
      <select
        className={INPUT_CLASS}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose {column.label.toLowerCase()}</option>
        {options
          .filter((option) => !option.archived_at)
          .map((option) => (
            // Giá trị là option.id, giống Task, Enrollment và Leads. Gửi label
            // thì ô sửa tại chỗ (khớp theo id) sẽ hiện rỗng ngay sau khi tạo.
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
      </select>
    );
  }

  return (
    <input
      className={INPUT_CLASS}
      type={column.type === "number" ? "number" : column.type === "date" ? "date" : "text"}
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(event) => onChange(event.target.value)}
      placeholder={
        column.type === "link" ? "https://..." : `Enter ${column.label.toLowerCase()}`
      }
    />
  );
}

export function AddProviderDialog({
  open,
  columns,
  columnOptions,
  onClose,
  onCreate,
}: {
  open: boolean;
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
  onClose: () => void;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [textValues, setTextValues] = useState<Partial<Record<ProviderTextField, string>>>({});
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const customColumns = useMemo(
    () => columns.filter((column) => !column.is_system && !column.archived_at),
    [columns]
  );
  const labelByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column.label])),
    [columns]
  );
  const optionsByColumnId = useMemo(() => {
    const map = new Map<string, TableColumnOption[]>();
    for (const option of columnOptions) {
      const list = map.get(option.column_id) ?? [];
      list.push(option);
      map.set(option.column_id, list);
    }
    return map;
  }, [columnOptions]);

  useBodyScrollLock(open);
  if (!open) return null;

  function reset() {
    setTextValues({});
    setCustomValues({});
    setError(null);
  }

  async function submit() {
    // Cùng luật với server: một dòng không có cả tên bác sĩ lẫn tên cơ sở thì
    // không ai tra cứu được. Kiểm ở đây để người dùng biết ngay, không phải
    // chờ một vòng gọi API mới thấy lỗi.
    if (!textValues.doctors?.trim() && !textValues.facility?.trim()) {
      setError("Doctor or facility is required.");
      return;
    }
    // Cột Required do admin đặt trong /config — form phải đánh dấu đúng những
    // cột mà server sẽ từ chối, nếu không người dùng bị chặn vì một ô mà màn
    // hình không hề nói là bắt buộc.
    const missing = columns
      .filter((column) => column.required && !column.archived_at)
      .filter((column) => {
        const value = column.is_system
          ? textValues[column.key as ProviderTextField]
          : customValues[column.key];
        return !isFilled(value, column.type);
      });
    if (missing.length > 0) {
      setError(`${missing.map((column) => column.label).join(", ")} required.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onCreate({ ...textValues, custom_values: customValues });
      reset();
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not add the provider."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[#091e42]/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add address"
        className="flex max-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#dfe1e6] px-5 py-3">
          <h2 className="text-base font-bold text-[#172b4d]">Add address</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded p-1 text-[#6b778c] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <p className="mb-4 rounded border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-2 text-xs font-medium text-[#5e6c84]">
            Rows added here are kept in the portal. The nightly Google Sheet sync
            never replaces them.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {PROVIDER_TEXT_FIELDS.map((field) => {
              const column = columns.find((candidate) => candidate.key === field);
              if (column?.hidden_default) return null;
              return (
                <label key={field} className="block space-y-1">
                  <span className={LABEL_CLASS}>
                    {labelByKey.get(field) ?? field}
                    {column?.required ? <span className="text-[#bf2600]"> *</span> : null}
                  </span>
                  <input
                    className={INPUT_CLASS}
                    value={textValues[field] ?? ""}
                    onChange={(event) =>
                      setTextValues((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                    placeholder={`Enter ${(labelByKey.get(field) ?? field).toLowerCase()}`}
                  />
                </label>
              );
            })}
          </div>

          {customColumns.length > 0 ? (
            <div className="mt-4 border-t border-[#e6eaf0] pt-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-[#667085]">
                Additional information
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {customColumns.map((column) => (
                  <label key={column.id} className="block space-y-1">
                    <span className={LABEL_CLASS}>
                      {column.label}
                      {column.required ? <span className="text-[#bf2600]"> *</span> : null}
                    </span>
                    <CustomProviderField
                      column={column}
                      options={optionsByColumnId.get(column.id) ?? []}
                      value={customValues[column.key]}
                      onChange={(value) =>
                        setCustomValues((current) => ({ ...current, [column.key]: value }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-semibold text-[#bf2600]">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#dfe1e6] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded px-3 py-2 text-sm font-bold text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#0055cc] disabled:opacity-60"
          >
            {saving ? "Adding…" : "Add address"}
          </button>
        </div>
      </div>
    </div>
  );
}

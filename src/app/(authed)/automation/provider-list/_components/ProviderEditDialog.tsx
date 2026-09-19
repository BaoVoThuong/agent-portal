"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ExternalLink, Search, X } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { parseMultiselectValue } from "@/lib/table-config/multiselect";
import { tableColumnOptionBadgePalette } from "@/lib/table-config/value-colors";
import { parsePlanCell } from "@/lib/providers/plans";
import {
  parseSpecialtyCell,
  PROVIDER_SPECIALTY_OPTIONS,
  isProviderSpecialtyField,
} from "@/lib/providers/specialties";
import {
  PROVIDER_META_FIELDS,
  PROVIDER_TEXT_FIELDS,
  type ProviderRow,
} from "@/lib/providers/types";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-[#d8dee7] bg-white px-3 text-sm font-semibold text-[#172b4d] shadow-none outline-none transition placeholder:text-[#98a2b3] focus:border-[#0c66e4] focus:ring-4 focus:ring-[#deebff]";
// `h-9` của INPUT_CLASS là chiều cao CỐ ĐỊNH, phải ghi đè bằng `!h-auto` thì
// textarea mới co giãn được. min-h-16 đủ cho 2 dòng; kéo tay nếu cần thêm.
const TEXTAREA_CLASS = `${INPUT_CLASS} !h-auto min-h-16 resize-y py-2`;
const LABEL_CLASS = "mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]";

function isPlanColumn(key: string): boolean {
  return key === "obamacare" || key === "medicare";
}

function isMultiselectColumn(column: TableColumn): boolean {
  return column.type === "multiselect" || isProviderSpecialtyField(column.key) || isPlanColumn(column.key);
}

function isProviderTextKey(key: string): key is (typeof PROVIDER_TEXT_FIELDS)[number] {
  return (PROVIDER_TEXT_FIELDS as readonly string[]).includes(key);
}

function isNewPatientColumn(column: TableColumn): boolean {
  return column.key === "accepting_new_patients";
}

function isReviewedColumn(column: TableColumn): boolean {
  return column.key === "needs_review";
}

function isTruthyProviderValue(value: unknown): boolean {
  return ["yes", "true", "1", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function isReadOnlyColumn(column: TableColumn): boolean {
  return (
    column.is_system &&
    (PROVIDER_META_FIELDS as readonly string[]).includes(column.key)
  );
}

function valueForColumn(provider: ProviderRow, column: TableColumn): unknown {
  if (isProviderTextKey(column.key)) return provider[column.key];
  if (column.is_system) {
    if (column.key === "needs_review") return provider.needs_review;
    if ((PROVIDER_META_FIELDS as readonly string[]).includes(column.key)) {
      return provider[column.key as keyof ProviderRow];
    }
    return null;
  }
  return provider.custom_values?.[column.key] ?? null;
}

function initialValues(provider: ProviderRow, columns: readonly TableColumn[]) {
  return Object.fromEntries(
    columns
      .filter((column) => !column.archived_at)
      .map((column) => {
        const raw = valueForColumn(provider, column);
        if (isNewPatientColumn(column)) {
          return [column.key, isTruthyProviderValue(raw)];
        }
        if (isReviewedColumn(column)) {
          return [column.key, !isTruthyProviderValue(raw)];
        }
        if (isMultiselectColumn(column)) {
          const values = isProviderSpecialtyField(column.key)
            ? parseSpecialtyCell(raw)
            : isPlanColumn(column.key)
              ? parsePlanCell(raw as string | null)
              : parseMultiselectValue(raw);
          return [column.key, values];
        }
        return [column.key, raw ?? ""];
      })
  ) as Record<string, unknown>;
}

function specialtyOptions(column: TableColumn, options: readonly TableColumnOption[]) {
  const byLabel = new Map(options.map((option) => [option.label.toLowerCase(), option]));
  return PROVIDER_SPECIALTY_OPTIONS.map(
    (label, index) =>
      byLabel.get(label.toLowerCase()) ?? {
        id: `provider-specialty-${index}`,
        column_id: column.id,
        label,
        color: null,
        position: (index + 1) * 10,
        archived_at: null,
      }
  );
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function isLongTextColumn(column: TableColumn, value: unknown): boolean {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return column.key === "business_hours" || stringValue.length > 120;
}

/**
 * Một ô chiếm mấy cột trong lưới 6 cột.
 *
 * Lưới 6 thay vì 3: với 3 cột thì ô hẹp nhất vẫn ~360px, nên `TX` và `77036`
 * trôi giữa một khoảng trống. Chia 6 cho phép State/ZIP chỉ lấy đúng 1/6 và cả
 * dòng địa chỉ xếp gọn trên một hàng.
 *
 *   6 — ACA/Medicare plans: mang được cả chục chip, hẹp lại là chip tràn dòng.
 *   4 — Specialty, Business hours: cần rộng nhưng không cần trọn hàng.
 *   2 — ô chữ thường (bằng đúng 1 cột của lưới 3 cũ).
 *   1 — State, ZIP, và ô tick: nội dung chỉ vài ký tự.
 */
function editFieldSpan(column: TableColumn, value: unknown): 1 | 2 | 4 | 6 {
  if (isPlanColumn(column.key)) return 6;
  if (isMultiselectColumn(column)) return isProviderSpecialtyField(column.key) ? 4 : 6;
  if (column.key === "business_hours") return 4;
  if (isLongTextColumn(column, value)) return 6;
  if (column.type === "checkbox" || isNewPatientColumn(column) || isReviewedColumn(column)) return 1;
  if (column.key === "state" || column.key === "zip_code") return 1;
  return 2;
}

// Tailwind chỉ giữ được class viết nguyên văn, nên phải liệt kê đủ chứ không
// ghép chuỗi. Dưới `md` lưới chỉ có 2 cột và mọi ô đều trải hết chiều ngang.
const SPAN_CLASS: Record<1 | 2 | 4 | 6, string> = {
  1: "col-span-2 min-w-0 md:col-span-1",
  2: "col-span-2 min-w-0 md:col-span-2",
  4: "col-span-2 min-w-0 md:col-span-4",
  6: "col-span-2 min-w-0 md:col-span-6",
};

export function ProviderEditDialog({
  provider,
  columns,
  columnOptions,
  onClose,
  onSave,
}: {
  provider: ProviderRow | null;
  columns: readonly TableColumn[];
  columnOptions: readonly TableColumnOption[];
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const open = provider !== null;
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    provider ? initialValues(provider, columns) : {}
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);

  const optionsByColumn = useMemo(() => {
    const map = new Map<string, TableColumnOption[]>();
    for (const option of columnOptions) {
      const list = map.get(option.column_id) ?? [];
      list.push(option);
      map.set(option.column_id, list);
    }
    return map;
  }, [columnOptions]);

  if (!provider) return null;
  const currentProvider = provider;

  const editableColumns = columns.filter(
    (column) => !column.archived_at && !isReadOnlyColumn(column)
  );
  const readOnlyColumns = columns.filter(
    (column) => !column.archived_at && isReadOnlyColumn(column)
  );
  function optionsFor(column: TableColumn): TableColumnOption[] {
    if (isProviderSpecialtyField(column.key)) {
      return specialtyOptions(column, optionsByColumn.get(column.id) ?? []);
    }
    return optionsByColumn.get(column.id) ?? [];
  }

  function setValue(key: string, value: unknown) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const systemPatch: Record<string, unknown> = {};
      const customValues: Record<string, unknown> = {
        ...(currentProvider.custom_values ?? {}),
      };

      for (const column of editableColumns) {
        const value = values[column.key];
        if (isReviewedColumn(column)) {
          systemPatch[column.key] = value !== true;
        } else if (isProviderTextKey(column.key)) {
          systemPatch[column.key] = isNewPatientColumn(column)
            ? value === true
              ? "Yes"
              : "No"
            : isMultiselectColumn(column)
              ? value
              : value === ""
                ? null
                : value;
        } else if (!column.is_system) {
          customValues[column.key] = value === "" ? null : value;
        }
      }

      await onSave({ ...systemPatch, custom_values: customValues });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save provider.");
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
        aria-label={`Edit provider ${provider.doctors || provider.facility || provider.id}`}
        className="flex h-[calc(100dvh-5rem)] max-h-[760px] w-full max-w-[1160px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-[#dfe1e6] px-4 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-sm font-bold text-[#97a0af]">
              Provider
            </span>
            <span className="shrink-0 rounded-full bg-[#edf4ff] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#0c66e4]">
              Edit
            </span>
            <span className="shrink-0 text-[#c1c7d0]">·</span>
            <h2 className="min-w-0 truncate text-base font-bold text-[#172b4d] sm:text-lg">
              {provider.doctors || provider.facility || "Edit provider"}
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="mx-auto max-w-[1120px]">
            <section className="border-b border-[#dfe1e6] pb-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#172b4d]">Provider details</h3>
                </div>
                <span className="text-[11px] font-semibold text-[#97a0af]">
                  {editableColumns.length} editable fields
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 md:grid-cols-6">
                {editableColumns.map((column) => (
                  <div
                    key={column.id}
                    className={SPAN_CLASS[editFieldSpan(column, values[column.key])]}
                  >
                    <ProviderEditField
                      column={column}
                      value={values[column.key]}
                      options={optionsFor(column)}
                      onChange={(value) => setValue(column.key, value)}
                    />
                  </div>
                ))}
              </div>
            </section>

            {readOnlyColumns.length > 0 ? (
              <section className="border-b border-[#dfe1e6] py-4">
                <div className="mb-2">
                  <h3 className="text-sm font-bold text-[#172b4d]">System information</h3>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {readOnlyColumns.map((column) => (
                    <div key={column.id} className="min-w-0 rounded-lg border border-[#dfe1e6] bg-[#f7f9fc] px-3 py-2">
                      <div className={LABEL_CLASS}>{column.label}</div>
                      <div className="truncate text-xs font-semibold text-[#5e6c84]" title={displayValue(values[column.key])}>
                        {displayValue(values[column.key])}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {error ? (
              <p className="rounded-xl border border-[#ffbdad] bg-[#ffebe6] px-4 py-3 text-sm font-semibold text-[#bf2600]">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[#dfe1e6] bg-white px-4 py-2.5 sm:px-5">
          <p className="hidden text-xs text-[#7a869a] sm:block">Changes are saved to the provider directory.</p>
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
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-[#0c66e4] px-4 py-2 text-sm font-bold text-white shadow-[0_2px_5px_rgba(9,30,66,0.16)] transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}

function ProviderEditField({
  column,
  value,
  options,
  onChange,
}: {
  column: TableColumn;
  value: unknown;
  options: readonly TableColumnOption[];
  onChange: (value: unknown) => void;
}) {
  const label = (
    <span className={LABEL_CLASS}>
      {isNewPatientColumn(column)
        ? "New Patient"
        : isReviewedColumn(column)
          ? "Reviewed"
          : column.label}
      {column.required ? <span className="text-[#bf2600]"> *</span> : null}
    </span>
  );

  if (isNewPatientColumn(column) || isReviewedColumn(column)) {
    const checked = isReviewedColumn(column)
      ? value === true
      : value === true || isTruthyProviderValue(value);
    const toggleLabel = isReviewedColumn(column)
      ? "Record has been checked"
      : "Accepting new patients";
    return (
      <div>
        {label}
        {/* Chỉ một ô tick. Bản cũ là nút to chiếm trọn chiều ngang, kèm câu mô
            tả và huy hiệu Yes/No — ba cách nói cùng một giá trị đúng/sai, và
            chiếm chỗ ngang bằng một ô nhập chữ. Nhãn cột ở trên đã nói rõ đây
            là trường gì. */}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => onChange(!checked)}
          className={`flex h-9 w-full items-center justify-center rounded-lg border transition focus:outline-none focus:ring-4 focus:ring-[#deebff] ${
            checked
              ? "border-[#b7e4d0] bg-[#f0fbf5]"
              : "border-[#d8dee7] bg-white hover:border-[#b8c4d4]"
          }`}
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
              checked
                ? "border-[#16a66a] bg-[#16a66a] text-white"
                : "border-[#c7d1e0] bg-white"
            }`}
          >
            {checked ? <Check className="h-3.5 w-3.5" /> : null}
          </span>
        </button>
      </div>
    );
  }

  if (isMultiselectColumn(column)) {
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : isProviderSpecialtyField(column.key)
        ? parseSpecialtyCell(value)
        : isPlanColumn(column.key)
          ? parsePlanCell(value as string | null)
          : parseMultiselectValue(value);
    return (
      <MultiSelectField
        label={label}
        selected={selected}
        options={options}
        onChange={onChange}
      />
    );
  }

  if (column.type === "checkbox") {
    return (
      <label className="flex h-9 items-center gap-2 rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#344054]">
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
      <label className="block min-w-0">
        {label}
        <select className={INPUT_CLASS} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}>
          <option value="">Choose {column.label.toLowerCase()}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  const stringValue = value === null || value === undefined ? "" : String(value);
  const isLongText = isLongTextColumn(column, value);
  return (
    <label className="block min-w-0">
      {label}
      {isLongText ? (
        <textarea
          className={TEXTAREA_CLASS}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`Enter ${column.label.toLowerCase()}`}
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            className={INPUT_CLASS}
            type={column.type === "number" ? "number" : column.type === "date" ? "date" : column.type === "link" ? "url" : "text"}
            value={stringValue}
            onChange={(event) => onChange(event.target.value)}
            placeholder={`Enter ${column.label.toLowerCase()}`}
          />
          {column.type === "link" && stringValue ? (
            <a
              href={/^https?:\/\//i.test(stringValue) ? stringValue : `https://${stringValue}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#b3d4ff] bg-[#deebff] text-[#0055cc] transition hover:bg-[#cce0ff]"
              aria-label={`Open ${column.label}`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
        </div>
      )}
    </label>
  );
}

function MultiSelectField({
  label,
  selected,
  options,
  onChange,
}: {
  label: ReactNode;
  selected: string[];
  options: readonly TableColumnOption[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedSet = new Set(selected.map((item) => item.toLowerCase()));

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleOption(option: TableColumnOption) {
    const normalizedLabel = option.label.toLowerCase();
    onChange(
      selectedSet.has(normalizedLabel)
        ? selected.filter((item) => item.toLowerCase() !== normalizedLabel)
        : [...selected, option.label]
    );
  }

  function chipStyle(value: string) {
    const option = options.find((item) => item.label.toLowerCase() === value.toLowerCase());
    if (!option) return { backgroundColor: "#eef2f6", color: "#475467" };
    const palette = tableColumnOptionBadgePalette(option);
    return { backgroundColor: palette.background, color: palette.foreground };
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      {label}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-lg border bg-white px-3 py-1.5 text-left shadow-none outline-none transition focus:ring-4 focus:ring-[#deebff] ${
          open ? "border-[#0c66e4]" : "border-[#d8dee7] hover:border-[#b8c4d4]"
        }`}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {selected.length === 0 ? (
            <span className="text-sm font-medium text-[#98a2b3]">Choose values</span>
          ) : (
            <>
              {selected.slice(0, 3).map((item) => (
                <span
                  key={item}
                  className="max-w-[220px] truncate rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em]"
                  style={chipStyle(item)}
                >
                  {item}
                </span>
              ))}
              {selected.length > 3 ? (
                <span className="rounded-md bg-[#f2f4f7] px-2 py-1 text-[10px] font-bold text-[#667085]">
                  +{selected.length - 3} more
                </span>
              ) : null}
            </>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[#667085] transition ${open ? "rotate-180" : ""}`} />
      </button>
      <div className="mt-0.5 flex items-center justify-between text-[10px] font-medium text-[#7a869a]">
        <span>{selected.length} selected</span>
        {selected.length > 0 ? (
          <button type="button" className="font-bold text-[#0c66e4] hover:underline" onClick={() => onChange([])}>
            Clear
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+28px)] z-50 overflow-hidden rounded-xl border border-[#d8dee7] bg-white shadow-[0_14px_36px_rgba(9,30,66,0.18)]">
          <div className="border-b border-[#edf0f4] p-2">
            <div className="flex h-9 items-center gap-2 rounded-lg bg-[#f7f9fc] px-2.5">
              <Search className="h-4 w-4 text-[#98a2b3]" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search values..."
                className="min-w-0 flex-1 bg-transparent text-sm text-[#172b4d] outline-none placeholder:text-[#98a2b3]"
              />
            </div>
          </div>
          <div role="listbox" className="max-h-56 overflow-y-auto p-1.5">
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-[#7a869a]">No matching values</p>
            ) : (
              filteredOptions.map((option) => {
                const checked = selectedSet.has(option.label.toLowerCase());
                const palette = tableColumnOptionBadgePalette(option);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggleOption(option)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                      checked ? "bg-[#edf4ff]" : "hover:bg-[#f7f9fc]"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? "border-[#0c66e4] bg-[#0c66e4] text-white" : "border-[#c7d1e0] bg-white"
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span
                      className="truncate rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em]"
                      style={{ backgroundColor: palette.background, color: palette.foreground }}
                    >
                      {option.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-[#edf0f4] bg-[#fbfcfe] px-3 py-2 text-[11px] text-[#667085]">
            Select one or more values
          </div>
        </div>
      ) : null}
    </div>
  );
}

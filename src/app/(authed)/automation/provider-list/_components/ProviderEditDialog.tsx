"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, X } from "lucide-react";
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
  "h-10 w-full rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#172b4d] outline-none transition focus:border-[#0c66e4] focus:ring-2 focus:ring-[#deebff]";
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-24 resize-y py-2.5`;
const LABEL_CLASS = "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-[#667085]";

function isPlanColumn(key: string): boolean {
  return key === "obamacare" || key === "medicare";
}

function isMultiselectColumn(column: TableColumn): boolean {
  return column.type === "multiselect" || isProviderSpecialtyField(column.key) || isPlanColumn(column.key);
}

function isProviderTextKey(key: string): key is (typeof PROVIDER_TEXT_FIELDS)[number] {
  return (PROVIDER_TEXT_FIELDS as readonly string[]).includes(key);
}

function isReadOnlyColumn(column: TableColumn): boolean {
  return (
    column.key === "needs_review" ||
    (column.is_system &&
      (PROVIDER_META_FIELDS as readonly string[]).includes(column.key))
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
        if (isProviderTextKey(column.key)) {
          systemPatch[column.key] =
            isMultiselectColumn(column) ? value : value === "" ? null : value;
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
      className="fixed inset-0 z-[180] flex items-center justify-center bg-[#091e42]/55 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit provider ${provider.doctors || provider.facility || provider.id}`}
        className="flex max-h-[min(54rem,calc(100vh-2rem))] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-[0_24px_80px_rgba(9,30,66,0.3)]"
      >
        <div className="flex items-center justify-between border-b border-[#dfe1e6] px-6 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#7a869a]">
              Provider record
            </p>
            <h2 className="mt-1 text-xl font-bold text-[#172b4d]">
              {provider.doctors || provider.facility || "Edit provider"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#6b778c] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-5 rounded-lg border border-[#deebff] bg-[#f7faff] px-4 py-3 text-sm text-[#42526e]">
            Click any provider row to edit the complete record. Changes are saved to the provider directory.
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {editableColumns.map((column) => (
              <ProviderEditField
                key={column.id}
                column={column}
                value={values[column.key]}
                options={optionsFor(column)}
                onChange={(value) => setValue(column.key, value)}
              />
            ))}
          </div>

          {readOnlyColumns.length > 0 ? (
            <div className="mt-6 border-t border-[#ebecf0] pt-5">
              <h3 className="mb-3 text-sm font-bold text-[#172b4d]">System information</h3>
              <div className="grid gap-3 md:grid-cols-3">
                {readOnlyColumns.map((column) => (
                  <div key={column.id} className="rounded-lg border border-[#ebecf0] bg-[#f7f9fc] px-3 py-2.5">
                    <div className={LABEL_CLASS}>{column.label}</div>
                    <div className="truncate text-sm font-semibold text-[#5e6c84]" title={displayValue(values[column.key])}>
                      {displayValue(values[column.key])}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="mt-5 rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-semibold text-[#bf2600]">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#dfe1e6] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-bold text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-[#0c66e4] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
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
      {column.label}
      {column.required ? <span className="text-[#bf2600]"> *</span> : null}
    </span>
  );

  if (isMultiselectColumn(column)) {
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : isProviderSpecialtyField(column.key)
        ? parseSpecialtyCell(value)
        : isPlanColumn(column.key)
          ? parsePlanCell(value as string | null)
          : parseMultiselectValue(value);
    const selectedSet = new Set(selected.map((item) => item.toLowerCase()));
    return (
      <label className="block min-w-0 md:col-span-2">
        {label}
        <div className="max-h-36 overflow-y-auto rounded-lg border border-[#dfe1e6] bg-white p-2">
          <div className="grid gap-1 sm:grid-cols-2">
            {options.map((option) => {
              const checked = selectedSet.has(option.label.toLowerCase());
              const palette = tableColumnOptionBadgePalette(option);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() =>
                    onChange(
                      checked
                        ? selected.filter((item) => item.toLowerCase() !== option.label.toLowerCase())
                        : [...selected, option.label]
                    )
                  }
                  className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                    checked ? "bg-[#e9f2ff]" : "hover:bg-[#f4f5f7]"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      checked ? "border-[#0c66e4] bg-[#0c66e4] text-white" : "border-[#c7d1e0]"
                    }`}
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span
                    className="min-w-0 truncate rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.025em]"
                    style={{ backgroundColor: palette.background, color: palette.foreground }}
                  >
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <span className="mt-1 block text-xs font-medium text-[#7a869a]">
          {selected.length} selected
        </span>
      </label>
    );
  }

  if (column.type === "checkbox") {
    return (
      <label className="flex h-10 items-center gap-2 rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#344054]">
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
  const isLongText = column.key === "business_hours" || stringValue.length > 120;
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
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#b3d4ff] bg-[#deebff] text-[#0055cc]"
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

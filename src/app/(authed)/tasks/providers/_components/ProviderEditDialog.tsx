"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import type { ProviderRow } from "@/lib/providers/types";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";
import {
  isReadOnlyProviderColumn,
  providerFormPayload,
  providerFormValues,
} from "@/lib/providers/form";
import { ProviderFormBody } from "./ProviderFormFields";

export function ProviderEditDialog({
  provider,
  columns,
  columnOptions,
  viewerName,
  onClose,
  onSave,
  onArchive,
}: {
  provider: ProviderRow | null;
  columns: readonly TableColumn[];
  columnOptions: readonly TableColumnOption[];
  /** Tên người đang đăng nhập — điền vào Verified by khi bật ô Reviewed. */
  viewerName: string;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  /** Chỉ truyền cho người có quyền Manage; không truyền thì không có nút xoá. */
  onArchive?: () => Promise<void>;
}) {
  const open = provider !== null;
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    provider ? providerFormValues(provider, columns) : {}
  );
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);

  if (!provider) return null;
  const currentProvider = provider;

  const editableColumns = columns.filter(
    (column) => !column.archived_at && !isReadOnlyProviderColumn(column)
  );

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(
        providerFormPayload(values, editableColumns, currentProvider.custom_values ?? {})
      );
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save provider.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (saving || !onArchive) return;
    setSaving(true);
    setError(null);
    try {
      await onArchive();
      onClose();
    } catch (archiveError) {
      setConfirmingDelete(false);
      setError(
        archiveError instanceof Error ? archiveError.message : "Could not delete the address."
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

        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 py-4 sm:px-5">
          <ProviderFormBody
            columns={columns}
            columnOptions={columnOptions}
            values={values}
            viewerName={viewerName}
            showSystemInfo
            onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
          />
          {error ? (
            <p className="mx-auto mt-3 max-w-[1120px] rounded-xl border border-[#ffbdad] bg-[#ffebe6] px-4 py-3 text-sm font-semibold text-[#bf2600]">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[#dfe1e6] bg-white px-4 py-2.5 sm:px-5">
          {onArchive ? (
            confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-2" role="alert">
                <span className="text-sm font-semibold text-[#bf2600]">
                  Delete this address? It disappears from the list.
                </span>
                <button
                  type="button"
                  onClick={() => void archive()}
                  disabled={saving}
                  className="rounded-lg bg-[#bf2600] px-3 py-1.5 text-sm font-bold text-white transition hover:bg-[#a52200] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={saving}
                  className="rounded px-3 py-1.5 text-sm font-bold text-[#42526e] transition hover:bg-[#f2f4f7]"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={saving}
                className="rounded px-3 py-2 text-sm font-bold text-[#bf2600] transition hover:bg-[#ffebe6] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete address
              </button>
            )
          ) : (
            <p className="hidden text-xs text-[#7a869a] sm:block">
              Changes are saved to the provider directory.
            </p>
          )}
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

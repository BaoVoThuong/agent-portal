"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { FileUp, X } from "lucide-react";
import type { TableColumn, TableScope } from "@/lib/table-config/types";

type ImportPreview = {
  request?: {
    id: string;
    status: string;
    summary?: {
      addCount?: number;
      updateCount?: number;
      errorCount?: number;
    };
  };
};

export function HealthTableImportDialog({
  scope,
  columns,
  onClose,
}: {
  scope: TableScope;
  columns: TableColumn[];
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [matchColumnKey, setMatchColumnKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const importableColumns = useMemo(
    () => columns.filter((column) => !column.archived_at),
    [columns]
  );

  async function chooseFile(nextFile: File | null) {
    setFile(nextFile);
    setHeaders([]);
    setMapping({});
    setPreview(null);
    setError(null);
    if (!nextFile) return;

    try {
      const nextHeaders = await readWorkbookHeaders(nextFile);
      setHeaders(nextHeaders);
      const autoMapping = autoMapHeaders(nextHeaders, importableColumns);
      setMapping(autoMapping);
      const preferredMatch =
        autoMapping["FUB Link"] ??
        autoMapping.fub ??
        autoMapping["Client Name"] ??
        autoMapping.client ??
        autoMapping.Task ??
        autoMapping.summary ??
        "";
      setMatchColumnKey(preferredMatch);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read this file.");
    }
  }

  async function submitImport() {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    if (!matchColumnKey) {
      setError("Choose a match column.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("scope", scope);
      form.set("match_column_key", matchColumnKey);
      form.set("column_mapping", JSON.stringify(mapping));
      form.set("file", file);
      const response = await fetch("/api/config/imports", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as
        | (ImportPreview & { error?: string })
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not submit import.");
      }
      setPreview(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit import.");
    } finally {
      setBusy(false);
    }
  }

  const summary = preview?.request?.summary;

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-[#091e42]/45 px-4">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#dfe1e6] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[#172b4d]">Import table data</h2>
            <p className="mt-0.5 text-sm font-medium text-[#6b778c]">
              Upload Excel or CSV, map columns, then another admin reviews it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded text-[#44546f] hover:bg-[#f4f5f7]"
            aria-label="Close import dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
          <label className="block rounded border border-dashed border-[#b3d4ff] bg-[#f7fbff] p-4">
            <span className="flex items-center gap-2 text-sm font-bold text-[#0c66e4]">
              <FileUp className="h-4 w-4" />
              Choose .xlsx or .csv file
            </span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="mt-3 block w-full text-sm font-medium text-[#42526e]"
              onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
            />
          </label>

          {headers.length > 0 ? (
            <>
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">
                  Match existing records by
                </label>
                <select
                  value={matchColumnKey}
                  onChange={(event) => setMatchColumnKey(event.target.value)}
                  className="mt-1 h-10 w-full rounded border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#172b4d]"
                >
                  <option value="">Choose match column</option>
                  {importableColumns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="overflow-hidden rounded border border-[#dfe1e6]">
                <div className="grid grid-cols-[1fr_1fr] bg-[#fafbfc] px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#6b778c]">
                  <span>File column</span>
                  <span>Portal column</span>
                </div>
                <div className="max-h-72 divide-y divide-[#ebecf0] overflow-auto">
                  {headers.map((header) => (
                    <div
                      key={header}
                      className="grid grid-cols-[1fr_1fr] items-center gap-3 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm font-semibold text-[#172b4d]">
                        {header}
                      </span>
                      <select
                        value={mapping[header] ?? ""}
                        onChange={(event) =>
                          setMapping((current) => ({
                            ...current,
                            [header]: event.target.value,
                          }))
                        }
                        className="h-9 rounded border border-[#dfe1e6] bg-white px-2 text-sm font-semibold text-[#42526e]"
                      >
                        <option value="">Ignore</option>
                        {importableColumns.map((column) => (
                          <option key={column.key} value={column.key}>
                            {column.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {summary ? (
            <div className="rounded border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm font-bold text-[#166534]">
              Import request submitted: {summary.addCount ?? 0} add,{" "}
              {summary.updateCount ?? 0} update, {summary.errorCount ?? 0} error.
            </div>
          ) : null}

          {error ? (
            <div className="rounded border border-[#ffbdad] bg-[#ffebe6] px-4 py-3 text-sm font-bold text-[#bf2600]">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-[#dfe1e6] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded px-4 text-sm font-bold text-[#42526e] hover:bg-[#f4f5f7]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void submitImport()}
            disabled={busy || !file || headers.length === 0 || !matchColumnKey}
            className="inline-flex h-10 items-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            <FileUp className="h-4 w-4" />
            Submit for review
          </button>
        </footer>
      </div>
    </div>
  );
}

async function readWorkbookHeaders(file: File): Promise<string[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The file has no sheets.");
  const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    defval: "",
  });
  const headerRow = rows[0] ?? [];
  const headers = headerRow
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (headers.length === 0) throw new Error("The first row must contain headers.");
  return headers;
}

function autoMapHeaders(
  headers: string[],
  columns: readonly TableColumn[]
): Record<string, string> {
  const byName = new Map<string, string>();
  for (const column of columns) {
    byName.set(normalizeName(column.key), column.key);
    byName.set(normalizeName(column.label), column.key);
  }
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    mapping[header] = byName.get(normalizeName(header)) ?? "";
  }
  return mapping;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

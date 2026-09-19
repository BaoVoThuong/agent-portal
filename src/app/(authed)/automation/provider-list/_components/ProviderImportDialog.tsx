"use client";

import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { AlertTriangle, Download, FileSpreadsheet, X } from "lucide-react";
import type { TableColumn } from "@/lib/table-config/types";
import {
  PROVIDER_IMPORT_TEMPLATE_HEADERS,
  matchProviderHeaders,
  parseProviderImportRows,
  providerImportPayload,
  type ProviderImportParse,
} from "@/lib/providers/import";
import { providerColumnWidth } from "@/lib/providers/list-columns";
import { todayForColumn } from "@/lib/providers/form";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const PREVIEW_ROWS = 6;

const SECTION_CLASS =
  "border border-[#dbe2eb] bg-white p-4 shadow-[0_1px_2px_rgba(22,35,58,0.04)]";
const SECTION_TITLE_CLASS =
  "text-xs font-bold uppercase tracking-[0.08em] text-[#667085]";

type ImportResult = {
  created: number;
  updated: number;
  failed: { row: number; error: string }[];
};

export function ProviderImportDialog({
  open,
  columns,
  viewerName,
  onClose,
  onImported,
}: {
  open: boolean;
  columns: TableColumn[];
  /** Tên người đang nhập — điền vào Verified by cho mọi dòng của lượt này. */
  viewerName: string;
  onClose: () => void;
  /** Nhập xong thì bảng phải nạp lại — dòng mới/đã sửa không nằm trong state cũ. */
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useBodyScrollLock(open);

  const matched = useMemo(
    () => matchProviderHeaders(headers, columns),
    [headers, columns]
  );
  // Một lượt nhập là MỘT lần xác nhận, nên cả lượt dùng chung một mốc thời gian
  // — không để dòng đầu và dòng cuối lệch nhau vì file to.
  const stamp = useMemo(
    () => ({
      verifiedBy: viewerName,
      verifiedDate: todayForColumn(columns.find((column) => column.key === "date")),
    }),
    [viewerName, columns]
  );
  const parsed: ProviderImportParse = useMemo(
    () => parseProviderImportRows(records, matched, columns, stamp),
    [records, matched, columns, stamp]
  );

  const createCount = parsed.rows.filter((row) => row.mode === "create").length;
  const updateCount = parsed.rows.filter((row) => row.mode === "update").length;
  // Duyệt theo `columns` chứ không theo thứ tự tiêu đề trong file: bản xem
  // trước phải xếp cột y hệt bảng List, nếu không người dùng phải đối chiếu hai
  // thứ tự khác nhau của cùng một bộ dữ liệu.
  const previewColumns = useMemo(() => {
    const matchedKeys = new Set(matched.byHeader.values());
    return columns.filter(
      (column) => !column.archived_at && matchedKeys.has(column.key)
    );
  }, [matched, columns]);

  const previewMinWidth = previewColumns.reduce(
    (total, column) => total + providerColumnWidth(column),
    0
  );

  if (!open) return null;

  function reset() {
    setFile(null);
    setHeaders([]);
    setRecords([]);
    setError(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setError(null);
    setResult(null);
    if (!next) return;
    if (next.size > MAX_BYTES) {
      reset();
      setError("That file is larger than 5 MB.");
      return;
    }
    try {
      const workbook = XLSX.read(await next.arrayBuffer(), { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("That file has no sheets.");
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: null,
      });
      const nextHeaders = (matrix[0] ?? [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
      if (nextHeaders.length === 0) {
        throw new Error("The first row must contain column headers.");
      }
      const nextRecords = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
      });
      if (nextRecords.length > MAX_ROWS) {
        throw new Error(
          `That file has ${nextRecords.length} rows. The limit is ${MAX_ROWS}.`
        );
      }
      setFile(next);
      setHeaders(nextHeaders);
      setRecords(nextRecords);
    } catch (readError) {
      reset();
      setError(
        readError instanceof Error ? readError.message : "That file could not be read."
      );
    }
  }

  function downloadTemplate() {
    // Đúng bộ cột và đúng thứ tự của Google Sheet đội đang dùng, kèm một dòng ví
    // dụ để thấy ngay định dạng từng ô. Không có cột ID: file mẫu là để THÊM
    // dòng mới — muốn sửa dòng có sẵn thì bấm Export, file đó mang sẵn ID.
    const header = [...PROVIDER_IMPORT_TEMPLATE_HEADERS];
    const example = header.map((name) => TEMPLATE_EXAMPLE[name] ?? "");
    const sheet = XLSX.utils.aoa_to_sheet([header, example]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Data");
    XLSX.writeFile(book, "provider-import-template.xlsx");
  }

  async function runImport() {
    if (parsed.rows.length === 0 || importing) return;
    setImporting(true);
    setError(null);
    try {
      const response = await fetch("/api/automation/provider-list/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: parsed.rows.map((row) => ({
            row: row.row,
            id: row.id,
            body: providerImportPayload(row.values, columns),
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "The import failed.");
      setResult({
        created: payload.created ?? 0,
        updated: payload.updated ?? 0,
        failed: payload.failed ?? [],
      });
      onImported();
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : "The import failed."
      );
    } finally {
      setImporting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !importing) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import providers"
        className="flex h-[calc(100vh-2rem)] max-h-[760px] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#e9f2ff] text-[#0c66e4]">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-[#172b4d]">Import providers</h2>
              <p className="mt-1 text-sm text-[#626f86]">
                Spreadsheet limit: {MAX_ROWS.toLocaleString("en-US")} rows and 5 MB.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <section className={SECTION_CLASS}>
              <div className="flex items-start justify-between gap-3">
                <h3 className={SECTION_TITLE_CLASS}>
                  1. Choose a file
                  <span className="text-[#bf2600]" title="Required">
                    {" *"}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[#0c66e4] transition hover:underline"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download template
                </button>
              </div>

              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFile}
                className="hidden"
                id="provider-import-file"
              />

              {/* Đã chọn file rồi thì vùng thả file thu lại thành một dòng: thứ
                  đáng nhìn lúc đó là bản xem trước bên dưới, không phải cái nút
                  vừa bấm xong. */}
              {file ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[#c8d4e2] bg-white px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileSpreadsheet className="h-5 w-5 shrink-0 text-[#0c66e4]" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#172b4d]">
                        {file.name}
                      </p>
                      <p className="text-xs text-[#626f86]">
                        {records.length} data rows · {headers.length} columns
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="h-8 shrink-0 rounded border border-[#dfe1e6] bg-white px-3 text-xs font-bold text-[#42526e] transition hover:bg-[#f4f5f7]"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="provider-import-file"
                  className="mt-3 flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-[#9fb3ca] bg-[#f7f9fc] px-4 py-6 text-center transition hover:border-[#0c66e4] hover:bg-[#f0f6ff]"
                >
                  <FileSpreadsheet className="h-6 w-6 text-[#626f86]" />
                  <span className="text-sm font-semibold text-[#172b4d]">
                    Choose an .xlsx or .csv file
                  </span>
                  <span className="text-xs text-[#626f86]">
                    Columns are matched by name — nothing to map. Rows with an{" "}
                    <strong>ID</strong> are updated, rows without one are added.
                  </span>
                </label>
              )}
            </section>

            {file ? (
              <section className={SECTION_CLASS}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className={SECTION_TITLE_CLASS}>2. Preview and import</h3>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Chip tone="create">{createCount} to add</Chip>
                    <Chip tone="update">{updateCount} to update</Chip>
                    {parsed.skipped.length > 0 ? (
                      <Chip tone="skip">{parsed.skipped.length} skipped</Chip>
                    ) : null}
                  </div>
                </div>

                {matched.ignored.length > 0 ? (
                  <p className="mt-3 flex items-start gap-2 rounded-lg border border-[#ffe2bd] bg-[#fffaf0] px-3 py-2 text-xs font-semibold text-[#974f0c]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Ignored — no matching column: {matched.ignored.join(", ")}
                    </span>
                  </p>
                ) : null}

                <p className="mt-3 text-xs text-[#626f86]">
                  <strong className="font-bold text-[#42526e]">Verified by</strong> and{" "}
                  <strong className="font-bold text-[#42526e]">Verified date</strong> are
                  set for every row from this import: {stamp.verifiedBy} ·{" "}
                  {stamp.verifiedDate}
                  {matched.managed.length > 0
                    ? ` (the file's ${matched.managed.join(", ")} is not used)`
                    : ""}
                  .
                </p>

                {previewColumns.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-xs font-semibold text-[#bf2600]">
                    No header matched a column on this table. Download the template to
                    see the expected column names.
                  </p>
                ) : (
                  // Cùng lưới, cùng độ rộng, cùng khoảng đệm với bảng List —
                  // xem `providerColumnWidth`.
                  <div className="mt-3 overflow-x-auto rounded-lg border border-[#dfe1e6]">
                    <div style={{ minWidth: previewMinWidth }}>
                      <div className="flex items-stretch whitespace-nowrap border-b border-[#dfe1e6] bg-[#fafbfc] text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
                        {previewColumns.map((column) => (
                          <div
                            key={column.id}
                            style={{ width: providerColumnWidth(column) }}
                            className="flex shrink-0 items-center px-3 py-2"
                          >
                            <span className="truncate">{column.label}</span>
                          </div>
                        ))}
                      </div>
                      {parsed.rows.slice(0, PREVIEW_ROWS).map((row) => (
                        <div
                          key={row.row}
                          className="flex items-stretch whitespace-nowrap border-b border-[#ebecf0] text-[13px] text-[#42526e] last:border-b-0"
                        >
                          {previewColumns.map((column) => (
                            <div
                              key={column.id}
                              style={{ width: providerColumnWidth(column) }}
                              className="flex min-w-0 shrink-0 items-center px-3 py-2.5"
                            >
                              <span className="truncate">
                                {formatPreview(row.values[column.key])}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {parsed.rows.length > PREVIEW_ROWS ? (
                  <p className="mt-2 text-xs text-[#626f86]">
                    Showing the first {PREVIEW_ROWS} of {parsed.rows.length} rows to
                    import.
                  </p>
                ) : null}

                {parsed.skipped.length > 0 ? (
                  <details className="mt-3 rounded-lg border border-[#dbe2eb] bg-[#f7f9fc] px-3 py-2">
                    <summary className="cursor-pointer text-xs font-bold text-[#42526e]">
                      {parsed.skipped.length} rows skipped
                    </summary>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-[#626f86]">
                      {parsed.skipped.slice(0, 50).map((item) => (
                        <li key={item.row}>
                          Row {item.row}: {item.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            ) : null}

            {result ? (
              <section className="border border-emerald-200 bg-emerald-50 p-4">
                <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-emerald-800">
                  Import finished
                </h3>
                <p className="mt-1.5 text-sm font-semibold text-emerald-900">
                  {result.created} added · {result.updated} updated
                  {result.failed.length > 0 ? ` · ${result.failed.length} failed` : ""}
                </p>
                {result.failed.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-[#bf2600]">
                    {result.failed.slice(0, 50).map((item) => (
                      <li key={`${item.row}-${item.error}`}>
                        Row {item.row}: {item.error}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {error ? (
              <p className="rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-4 py-3 text-sm font-semibold text-[#bf2600]">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#dfe1e6] bg-white px-6 py-4">
          <p className="hidden text-xs text-[#626f86] sm:block">
            Rows with an ID are updated. Rows without one are added.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={importing}
              className="rounded px-3 py-2 text-sm font-bold text-[#42526e] transition hover:bg-[#f4f5f7]"
            >
              {result ? "Close" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={importing || parsed.rows.length === 0 || result !== null}
              className="inline-flex items-center gap-2 rounded bg-[#0c66e4] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importing ? "Importing…" : "Import providers"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "create" | "update" | "skip";
  children: ReactNode;
}) {
  const palette =
    tone === "create"
      ? "bg-[#e6f6ed] text-[#216e4e]"
      : tone === "update"
        ? "bg-[#edf4ff] text-[#0c66e4]"
        : "bg-[#fffaf0] text-[#974f0c]";
  return (
    <span
      className={`inline-flex shrink-0 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${palette}`}
    >
      {children}
    </span>
  );
}

/** Một dòng ví dụ cho file mẫu, đúng định dạng mà bộ đọc file đang chấp nhận. */
const TEMPLATE_EXAMPLE: Record<string, string> = {
  Facility: "Houston Methodist",
  Doctors: "Hoang Anh Phan",
  NPI: "1407020035",
  "Practices As": "PCP - Adults, Cardiologist",
  "Accepting New Patients": "Yes",
  "Business Hours": "Mon - Fri: 8:00am - 5:00pm",
  Phone: "713-555-0123",
  Street: "7111 Harwin Dr, Ste 210",
  City: "Houston",
  State: "TX",
  "Zip Code": "77036",
  ObamaCare: "Ambetter HMO, Oscar HMO",
  Medicare: "UHC",
  "Other Plans": "",
};

function formatPreview(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ") || "—";
  return String(value);
}

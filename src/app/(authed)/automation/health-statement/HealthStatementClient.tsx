"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const carriers = [
  "AMBETTER",
  "ANTHEM",
  "BCBS",
  "CHRISTUS",
  "CIGNA",
  "MOLINA",
  "OSCAR",
  "UHC",
];

type FormState = {
  carrier: string;
  monthReport: string;
};

type PaymentFileInput = {
  id: string;
  statementNumber: string;
  file: File | null;
};

type ReviewCellValue = string | number | boolean | null;

type PreviewRow = {
  values: ReviewCellValue[];
};

type PreviewGroup = {
  count: number;
  headers: string[];
  rows: PreviewRow[];
};

type ReportPreviewData = {
  totals: {
    totalPayment: number;
    used: number;
    unclaimed: number;
    duplicate: number;
    final: number;
    balanced: boolean;
  };
  allPayment: PreviewGroup;
  paymentForProducer: PreviewGroup;
  unclaimedPayment: PreviewGroup;
  duplicatedPayment: PreviewGroup;
};

type ExcelPreviewCell = {
  value: ReviewCellValue;
  className?: string;
};

const initialForm: FormState = {
  carrier: "",
  monthReport: "",
};

const emptyTotals = {
  totalPayment: 0,
  used: 0,
  unclaimed: 0,
  duplicate: 0,
  final: 0,
  balanced: true,
};

const monthReportPattern = /^(0[1-9]|1[0-2])-\d{4}$/;
const EXCEL_PREVIEW_START_ROW = 8;
const EXCEL_PREVIEW_COLUMN_COUNT = 43;

const excelPreviewSections = [
  { column: 1, label: "All Payment" },
  { column: 12, label: "Producer Payment" },
  { column: 26, label: "Unclaim" },
  { column: 37, label: "Duplicate" },
];

function createMonthReportOptions() {
  const year = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    return `${month}-${year}`;
  });
}

function createPaymentFileInput(): PaymentFileInput {
  return {
    id: crypto.randomUUID(),
    statementNumber: "",
    file: null,
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMoney(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function formatCell(value: ReviewCellValue | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

function isBalanced(totalPayment: number, final: number) {
  return Math.round(totalPayment * 100) === Math.round(final * 100);
}

function getFilename(contentDisposition: string | null, fallback: string) {
  const match = contentDisposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
}

async function downloadResponseFile(response: Response, fallback: string) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getFilename(response.headers.get("content-disposition"), fallback);
  link.click();
  URL.revokeObjectURL(url);
}

function columnLabel(index: number) {
  let value = index;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

function cellKey(row: number, column: number) {
  return `${row}:${column}`;
}

function getExcelPreviewColumnWidth(column: number) {
  if ([10, 11, 24, 25, 35, 36, 40, 41, 42, 43].includes(column)) return 36;

  if (column >= 1 && column <= 9) {
    const widths = [116, 150, 140, 220, 128, 128, 156, 150, 116];
    return widths[column - 1] ?? 148;
  }

  if (column >= 12 && column <= 23) {
    const widths = [116, 120, 220, 120, 96, 180, 170, 150, 156, 128, 150, 116];
    return widths[column - 12] ?? 148;
  }

  if (column >= 26 && column <= 34) {
    const widths = [116, 150, 140, 220, 128, 128, 156, 150, 116];
    return widths[column - 26] ?? 148;
  }

  if (column >= 37 && column <= 39) {
    const widths = [150, 156, 120];
    return widths[column - 37] ?? 148;
  }

  return 148;
}

function getColumnOffset(column: number) {
  let offset = 46;

  for (let current = 1; current < column; current++) {
    offset += getExcelPreviewColumnWidth(current);
  }

  return offset;
}

function getColumnBandClass(column: number) {
  if (column >= 12 && column <= 23) return "bg-[#fbfdff]";
  if (column >= 26 && column <= 34) return "bg-[#fffdf7]";
  if (column >= 37 && column <= 39) return "bg-[#fbfffb]";
  return "bg-white";
}

function getColumnBoundaryClass(column: number) {
  if ([1, 12, 26, 37].includes(column)) {
    return "border-l-2 border-l-[#245a94]";
  }

  return "";
}

function buildExcelPreviewCells(data: ReportPreviewData) {
  const cells = new Map<string, ExcelPreviewCell>();
  const summaryClass = "bg-white font-bold text-[#16233a]";
  const titleClass = "bg-[#edf2f7] font-bold text-[#16233a]";
  const redLabelClass = "bg-white font-bold text-[#b42318]";
  const headerClass = "bg-[#dbeafe] font-semibold text-[#16233a]";
  const rightClass = "text-right";

  const setCell = (
    row: number,
    column: number,
    value: ReviewCellValue,
    className = ""
  ) => {
    cells.set(cellKey(row, column), { value, className });
  };

  const addTable = (startColumn: number, group: PreviewGroup) => {
    group.headers.forEach((header, index) => {
      setCell(10, startColumn + index, header, headerClass);
    });

    group.rows.forEach((row, rowIndex) => {
      group.headers.forEach((_, cellIndex) => {
        setCell(
          11 + rowIndex,
          startColumn + cellIndex,
          row.values[cellIndex] ?? null
        );
      });
    });
  };

  setCell(8, 2, "Total Payment", titleClass);
  setCell(8, 3, "Used", titleClass);
  setCell(8, 4, "Unclaimed", titleClass);
  setCell(8, 5, "Duplicate", titleClass);
  setCell(8, 6, "Final", titleClass);
  setCell(9, 1, "All Payment From Messer", redLabelClass);
  setCell(9, 2, formatMoney(data.totals.totalPayment), `${summaryClass} ${rightClass}`);
  setCell(9, 3, formatMoney(data.totals.used), `${summaryClass} ${rightClass}`);
  setCell(9, 4, formatMoney(data.totals.unclaimed), `${summaryClass} ${rightClass}`);
  setCell(9, 5, formatMoney(data.totals.duplicate), `${summaryClass} ${rightClass}`);
  setCell(9, 6, formatMoney(data.totals.final), `${summaryClass} ${rightClass}`);

  setCell(9, 12, "Payment For Producer", redLabelClass);
  setCell(9, 13, formatMoney(data.totals.used), `${summaryClass} ${rightClass}`);
  setCell(9, 26, "Unclaim Payment", redLabelClass);
  setCell(9, 27, formatMoney(data.totals.unclaimed), `${summaryClass} ${rightClass}`);
  setCell(9, 37, "Duplicated Payment", redLabelClass);
  setCell(9, 38, formatMoney(data.totals.duplicate), `${summaryClass} ${rightClass}`);

  addTable(1, data.allPayment);
  addTable(12, data.paymentForProducer);
  addTable(26, data.unclaimedPayment);
  addTable(37, data.duplicatedPayment);

  const maxDataRows = Math.max(
    data.allPayment.rows.length,
    data.paymentForProducer.rows.length,
    data.unclaimedPayment.rows.length,
    data.duplicatedPayment.rows.length
  );

  return {
    cells,
    maxRow: Math.max(10, 10 + maxDataRows),
  };
}

function ExcelSheetPreview({ data }: { data: ReportPreviewData }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { cells, maxRow } = useMemo(() => buildExcelPreviewCells(data), [data]);
  const columns = useMemo(
    () => Array.from({ length: EXCEL_PREVIEW_COLUMN_COUNT }, (_, i) => i + 1),
    []
  );
  const rows = useMemo(
    () =>
      Array.from(
        { length: maxRow - EXCEL_PREVIEW_START_ROW + 1 },
        (_, i) => EXCEL_PREVIEW_START_ROW + i
      ),
    [maxRow]
  );
  const jumpToColumn = (column: number) => {
    scrollRef.current?.scrollTo({
      left: column === 1 ? 0 : Math.max(0, getColumnOffset(column) - 8),
      behavior: "smooth",
    });
  };
  const blockSummaries = [
    {
      column: 1,
      label: "All Payment",
      rows: data.allPayment.count,
      total: data.totals.totalPayment,
    },
    {
      column: 12,
      label: "Producer Payment",
      rows: data.paymentForProducer.count,
      total: data.totals.used,
    },
    {
      column: 26,
      label: "Unclaim",
      rows: data.unclaimedPayment.count,
      total: data.totals.unclaimed,
    },
    {
      column: 37,
      label: "Duplicate",
      rows: data.duplicatedPayment.count,
      total: data.totals.duplicate,
    },
  ];

  return (
    <div>
      <div className="mb-3 grid gap-3 lg:grid-cols-4">
        {blockSummaries.map((block) => (
          <button
            key={block.column}
            type="button"
            onClick={() => jumpToColumn(block.column)}
            className="rounded-md border border-[#d8dee7] bg-white p-3 text-left transition hover:border-[#245a94] hover:bg-[#f8fafc]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-[#16233a]">
                {block.label}
              </span>
              <span className="text-xs font-semibold text-[#667085]">
                {block.rows} row(s)
              </span>
            </div>
            <div className="mt-2 text-sm font-semibold text-[#245a94]">
              {formatMoney(block.total)}
            </div>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[#667085]">
          Jump to
        </span>
        {excelPreviewSections.map((section) => (
          <button
            key={section.column}
            type="button"
            onClick={() => jumpToColumn(section.column)}
            className="h-8 rounded-md border border-[#cfd7e3] bg-white px-3 text-xs font-semibold text-[#245a94] transition hover:bg-[#f3f6fa]"
          >
            {section.label}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="max-h-[680px] overflow-auto rounded-md border border-[#cfd7e3] bg-white"
      >
        <table className="border-collapse table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: 46 }} />
            {columns.map((column) => (
              <col
                key={column}
                style={{ width: getExcelPreviewColumnWidth(column) }}
              />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="border border-[#b8c4d4] bg-[#edf2f7] px-2 py-1 text-center font-semibold text-[#667085]" />
              {columns.map((column) => (
                <th
                  key={column}
                  className={`border border-[#b8c4d4] bg-[#edf2f7] px-2 py-1 text-center font-semibold text-[#667085] ${getColumnBoundaryClass(column)}`}
                >
                  {columnLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th className="border border-[#b8c4d4] bg-[#edf2f7] px-2 py-1 text-center font-semibold text-[#667085]">
                  {row}
                </th>
                {columns.map((column) => {
                  const cell = cells.get(cellKey(row, column));
                  const value = formatCell(cell?.value);

                  return (
                    <td
                      key={column}
                      title={value}
                      className={`h-8 truncate border border-[#d8dee7] px-2 py-1 text-[#16233a] ${getColumnBandClass(column)} ${getColumnBoundaryClass(column)} ${
                        row === 10 ? "sticky top-[27px] z-10 shadow-sm" : ""
                      } ${cell?.className ?? ""}`}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExcelReportPreview({
  data,
  isDownloading,
  isLoading,
  onCreateExcel,
}: {
  data: ReportPreviewData | null;
  isDownloading: boolean;
  isLoading: boolean;
  onCreateExcel: () => void;
}) {
  return (
    <section className="rounded-lg border border-[#d8dee7] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e6ebf2] px-6 py-5">
        <div>
          <h2 className="text-base font-semibold text-[#16233a]">
            Excel Preview
          </h2>
          <p className="mt-1 text-sm text-[#667085]">
            {data ? "Health_Statement_Result" : "Building report preview"}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateExcel}
          disabled={!data || isLoading || isDownloading}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-[#245a94] px-4 text-sm font-semibold text-white transition hover:bg-[#1f4c7d] disabled:cursor-not-allowed disabled:bg-[#b8c4d4]"
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
            className={isDownloading ? "animate-spin" : ""}
          />
          {isDownloading ? "Creating..." : "Create Excel File"}
        </button>
      </div>

      <div className="px-6 py-6">
        {isLoading && !data ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-md border border-dashed border-[#cfd7e3] bg-[#f8fafc]">
            <div className="flex items-center gap-3 text-sm font-semibold text-[#245a94]">
              <RefreshCw size={18} aria-hidden="true" className="animate-spin" />
              Building Excel preview...
            </div>
          </div>
        ) : data ? (
          <ExcelSheetPreview data={data} />
        ) : null}
      </div>
    </section>
  );
}

export default function HealthStatementClient() {
  const monthReportOptions = useMemo(() => createMonthReportOptions(), []);
  const [form, setForm] = useState<FormState>(initialForm);
  const [paymentFiles, setPaymentFiles] = useState<PaymentFileInput[]>([
    createPaymentFileInput(),
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [reportPreview, setReportPreview] = useState<ReportPreviewData | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const reportTotals = reportPreview?.totals ?? emptyTotals;
  const selectedFileCount = paymentFiles.filter((item) => item.file).length;
  const status = isBalanced(reportTotals.totalPayment, reportTotals.final);

  const canRun = useMemo(
    () =>
      form.carrier.trim() !== "" &&
      monthReportPattern.test(form.monthReport) &&
      paymentFiles.length > 0 &&
      paymentFiles.every(
        (item) => item.statementNumber.trim() !== "" && Boolean(item.file)
      ),
    [form, paymentFiles]
  );

  const resetOutput = () => {
    setReportPreview(null);
    setError(null);
  };

  const updateField = (key: keyof FormState, value: string) => {
    resetOutput();
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updatePaymentFile = (
    id: string,
    next: Partial<Pick<PaymentFileInput, "statementNumber" | "file">>
  ) => {
    resetOutput();
    setPaymentFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, ...next } : item))
    );
  };

  const addPaymentFile = () => {
    resetOutput();
    setPaymentFiles((current) => [...current, createPaymentFileInput()]);
  };

  const removePaymentFile = (id: string) => {
    resetOutput();
    setPaymentFiles((current) =>
      current.length === 1 ? current : current.filter((item) => item.id !== id)
    );
  };

  const buildPayload = () => {
    const payload = new FormData();
    payload.set("carrier", form.carrier.trim());
    payload.set("monthReport", form.monthReport);
    paymentFiles.forEach((item) => {
      if (!item.file) return;
      payload.append("statementNumbers", item.statementNumber.trim());
      payload.append("files", item.file);
    });
    return payload;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRun) return;

    setIsRunning(true);
    setReportPreview(null);
    setError(null);

    try {
      const response = await fetch(
        "/api/automation/health-statement/report-preview",
        {
          method: "POST",
          body: buildPayload(),
        }
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Build preview failed");
      }

      setReportPreview((await response.json()) as ReportPreviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Build preview failed");
    } finally {
      setIsRunning(false);
    }
  };

  const handleCreateExcel = async () => {
    if (!canRun || !reportPreview) return;

    setIsDownloading(true);
    setError(null);

    try {
      const response = await fetch("/api/automation/health-statement/run", {
        method: "POST",
        body: buildPayload(),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Create Excel failed");
      }

      await downloadResponseFile(response, "health-statement-report.xlsx");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create Excel failed");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,520px)_minmax(360px,1fr)]">
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-[#d8dee7] bg-white shadow-sm"
        >
          <div className="border-b border-[#e6ebf2] px-6 py-5">
            <h2 className="text-base font-semibold text-[#16233a]">
              Statement Input
            </h2>
          </div>

          <div className="space-y-5 px-6 py-6">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[#344054]">
                Carrier
              </span>
              <input
                value={form.carrier}
                onChange={(event) =>
                  updateField("carrier", event.target.value.toUpperCase())
                }
                list="carrier-options"
                className="h-11 w-full rounded-md border border-[#cfd7e3] px-3 text-sm uppercase text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
                placeholder="MOLINA"
              />
              <datalist id="carrier-options">
                {carriers.map((carrier) => (
                  <option key={carrier} value={carrier} />
                ))}
              </datalist>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[#344054]">
                Month report
              </span>
              <input
                value={form.monthReport}
                onChange={(event) =>
                  updateField("monthReport", event.target.value)
                }
                list="month-report-options"
                className="h-11 w-full rounded-md border border-[#cfd7e3] px-3 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
                placeholder={monthReportOptions[0] ?? "01-2026"}
              />
              <datalist id="month-report-options">
                {monthReportOptions.map((monthReport) => (
                  <option key={monthReport} value={monthReport} />
                ))}
              </datalist>
            </label>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-[#344054]">
                  Payment files
                </span>
                <button
                  type="button"
                  onClick={addPaymentFile}
                  className="h-9 rounded-md border border-[#cfd7e3] px-3 text-sm font-semibold text-[#245a94] transition hover:bg-[#f3f6fa]"
                >
                  Add File
                </button>
              </div>

              <div className="space-y-3">
                {paymentFiles.map((item, index) => (
                  <div
                    key={item.id}
                    className="rounded-md border border-[#e1e7ef] bg-[#f8fafc] p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-[#16233a]">
                        File {index + 1}
                      </div>
                      <button
                        type="button"
                        onClick={() => removePaymentFile(item.id)}
                        disabled={paymentFiles.length === 1}
                        className="text-sm font-semibold text-[#b42318] disabled:cursor-not-allowed disabled:text-[#98a2b3]"
                      >
                        Remove
                      </button>
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-[#344054]">
                        Statement number
                      </span>
                      <input
                        value={item.statementNumber}
                        onChange={(event) =>
                          updatePaymentFile(item.id, {
                            statementNumber: event.target.value,
                          })
                        }
                        className="h-11 w-full rounded-md border border-[#cfd7e3] bg-white px-3 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
                        placeholder="58651"
                      />
                    </label>

                    <label className="mt-3 block">
                      <span className="mb-2 block text-sm font-medium text-[#344054]">
                        Payment file
                      </span>
                      <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={(event) =>
                          updatePaymentFile(item.id, {
                            file: event.target.files?.[0] ?? null,
                          })
                        }
                        className="block w-full rounded-md border border-dashed border-[#b8c4d4] bg-white px-3 py-3 text-sm text-[#344054] file:mr-4 file:rounded-md file:border-0 file:bg-[#245a94] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:bg-[#f3f6fa]"
                      />
                      <span className="mt-2 block truncate text-sm text-[#667085]">
                        {item.file
                          ? `${item.file.name} - ${formatFileSize(item.file.size)}`
                          : "No file selected"}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[#e6ebf2] px-6 py-4">
            <p className="text-sm text-[#667085]">
              {selectedFileCount} file(s) selected
            </p>
            <button
              type="submit"
              disabled={!canRun || isRunning || isDownloading}
              className="h-10 rounded-md bg-[#245a94] px-5 text-sm font-semibold text-white transition hover:bg-[#1f4c7d] disabled:cursor-not-allowed disabled:bg-[#b8c4d4]"
            >
              {isRunning
                ? "Building Preview..."
                : reportPreview
                  ? "Refresh Preview"
                  : "Run Report"}
            </button>
          </div>
        </form>

        <section className="rounded-lg border border-[#d8dee7] bg-white shadow-sm">
          <div className="border-b border-[#e6ebf2] px-6 py-5">
            <h2 className="text-base font-semibold text-[#16233a]">
              Statement Summary
            </h2>
          </div>
          <div className="px-6 py-6">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
                  Statements
                </dt>
                <dd className="mt-1 text-sm text-[#16233a]">
                  {paymentFiles
                    .map((item) => item.statementNumber.trim())
                    .filter(Boolean)
                    .join(", ") || "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
                  Carrier
                </dt>
                <dd className="mt-1 text-sm text-[#16233a]">
                  {form.carrier || "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
                  Month
                </dt>
                <dd className="mt-1 text-sm text-[#16233a]">
                  {form.monthReport || "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
                  Files
                </dt>
                <dd className="mt-1 truncate text-sm text-[#16233a]">
                  {selectedFileCount || "-"}
                </dd>
              </div>
            </dl>

            <div className="mt-8 rounded-md border border-[#d8dee7] bg-[#f8fafc] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-[#16233a]">
                  Statement Reconcile
                </div>
                <div
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    status
                      ? "bg-[#d1fadf] text-[#15803d]"
                      : "bg-[#fee2e2] text-[#b91c1c]"
                  }`}
                >
                  Status: {status ? "True" : "False"}
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-[#e6ebf2] bg-white">
                <div className="grid grid-cols-5 bg-[#edf2f7] text-xs font-semibold uppercase tracking-wide text-[#344054]">
                  <div className="px-3 py-2">Initial Payment</div>
                  <div className="px-3 py-2">Used</div>
                  <div className="px-3 py-2">Unclaimed</div>
                  <div className="px-3 py-2">Duplicate</div>
                  <div className="px-3 py-2">Final</div>
                </div>
                <div className="grid grid-cols-5 border-t border-[#e6ebf2] text-sm font-semibold text-[#16233a]">
                  <div className="px-3 py-3">
                    {formatMoney(reportTotals.totalPayment)}
                  </div>
                  <div className="px-3 py-3">
                    {formatMoney(reportTotals.used)}
                  </div>
                  <div className="px-3 py-3">
                    {formatMoney(reportTotals.unclaimed)}
                  </div>
                  <div className="px-3 py-3">
                    {formatMoney(reportTotals.duplicate)}
                  </div>
                  <div className="px-3 py-3">
                    {formatMoney(reportTotals.final)}
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-5 rounded-md border border-[#f2b8b5] bg-[#fff4f2] px-4 py-3 text-sm font-medium text-[#9f2f24]">
                {error}
              </div>
            )}
          </div>
        </section>
      </div>

      {(isRunning || reportPreview) && (
        <ExcelReportPreview
          data={reportPreview}
          isDownloading={isDownloading}
          isLoading={isRunning}
          onCreateExcel={handleCreateExcel}
        />
      )}
    </div>
  );
}

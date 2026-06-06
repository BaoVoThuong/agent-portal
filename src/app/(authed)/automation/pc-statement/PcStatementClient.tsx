"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

type PaymentFileInput = {
  id: string;
  file: File | null;
};

type ReviewCellValue = string | number | boolean | null;

type ReviewRow = {
  values: ReviewCellValue[];
};

type ReviewGroup = {
  count: number;
  headers: string[];
  rows: ReviewRow[];
};

type ReviewData = {
  totals: {
    totalPayment: number;
    basePolicy: number;
    additional: number;
    unclaimed: number;
    final: number;
    balanced: boolean;
  };
  lastBlackRow: number | null;
  paymentClean: ReviewGroup;
  oldPolicies: ReviewGroup;
  newPolicies: ReviewGroup;
};

type ReportPreviewData = {
  totals: ReviewData["totals"];
  lastBlackRow: number | null;
  paymentClean: ReviewGroup;
  policyInMonth: ReviewGroup;
  additionalPolicy: ReviewGroup;
  unclaimPayment: ReviewGroup;
};

type ReviewTab = "paymentClean" | "oldPolicies" | "newPolicies";

const emptyTotals = {
  allPaymentsRaw: 0,
  basePolicy: 0,
  additional: 0,
  unclaimed: 0,
  final: 0,
};

const reviewTabs: Array<{ key: ReviewTab; label: string }> = [
  { key: "paymentClean", label: "Payment" },
  { key: "oldPolicies", label: "Old Policies" },
  { key: "newPolicies", label: "New Policies" },
];

const EXCEL_PREVIEW_START_ROW = 8;
const EXCEL_PREVIEW_COLUMN_COUNT = 72;
const EXCEL_PREVIEW_COLUMN_WIDTH = 148;

const excelPreviewSections = [
  { column: 1, label: "Payment Clean" },
  { column: 8, label: "Policy In Month" },
  { column: 30, label: "Additional" },
  { column: 50, label: "Unclaim" },
];

type ExcelPreviewCell = {
  value: ReviewCellValue;
  className?: string;
};

function createPaymentFileInput(): PaymentFileInput {
  return {
    id: crypto.randomUUID(),
    file: null,
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function formatCell(value: ReviewCellValue | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

function isBalanced(total: number, final: number) {
  return Math.round(total * 100) === Math.round(final * 100);
}

function getFilename(contentDisposition: string | null, fallback: string) {
  const match = contentDisposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
}

function readNumberHeader(response: Response, key: string) {
  return Number(response.headers.get(key) ?? 0);
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

function ReviewTable({
  group,
  isLoading,
}: {
  group: ReviewGroup | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex min-h-[260px] items-center justify-center rounded-md border border-dashed border-[#cfd7e3] bg-[#f8fafc]">
        <div className="flex items-center gap-3 text-sm font-semibold text-[#245a94]">
          <RefreshCw size={18} aria-hidden="true" className="animate-spin" />
          Loading data...
        </div>
      </div>
    );
  }

  if (!group || group.rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[#cfd7e3] bg-[#f8fafc] px-4 py-10 text-center text-sm font-medium text-[#667085]">
        No rows loaded
      </div>
    );
  }

  return (
    <div className="max-h-[520px] overflow-auto rounded-md border border-[#e6ebf2]">
      <table className="min-w-[1240px] border-collapse bg-white text-left text-xs">
        <thead className="sticky top-0 bg-[#edf2f7] text-[#344054]">
          <tr>
            {group.headers.map((header, index) => (
              <th
                key={`${header}-${index}`}
                className="border-b border-[#d8dee7] px-3 py-2 font-semibold"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b border-[#eef2f6] last:border-0"
            >
              {group.headers.map((_, cellIndex) => {
                const value = formatCell(row.values[cellIndex]);

                return (
                  <td
                    key={cellIndex}
                    title={value}
                    className="max-w-[240px] truncate px-3 py-2 text-[#16233a]"
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
  );
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

function statementColumnWidth(offset: number) {
  const widths = [
    118, 118, 220, 260, 130, 150, 168, 128, 128, 150, 130, 132, 142, 230, 190,
    230, 240, 150, 180,
  ];

  return widths[offset] ?? EXCEL_PREVIEW_COLUMN_WIDTH;
}

function getExcelPreviewColumnWidth(column: number) {
  if ([7, 27, 28, 29, 49, 69, 70, 71, 72].includes(column)) return 36;

  if (column >= 1 && column <= 6) {
    const widths = [210, 150, 128, 140, 118, 150];
    return widths[column - 1] ?? EXCEL_PREVIEW_COLUMN_WIDTH;
  }

  if (column >= 8 && column <= 26) return statementColumnWidth(column - 8);
  if (column >= 30 && column <= 48) return statementColumnWidth(column - 30);
  if (column >= 50 && column <= 68) return statementColumnWidth(column - 50);

  return EXCEL_PREVIEW_COLUMN_WIDTH;
}

function getColumnOffset(column: number) {
  let offset = 46;

  for (let current = 1; current < column; current++) {
    offset += getExcelPreviewColumnWidth(current);
  }

  return offset;
}

function getColumnBandClass(column: number) {
  if (column >= 8 && column <= 26) return "bg-[#fbfdff]";
  if (column >= 30 && column <= 48) return "bg-[#fbfffb]";
  if (column >= 50 && column <= 68) return "bg-[#fffdf7]";
  return "bg-white";
}

function getColumnBoundaryClass(column: number) {
  if ([1, 8, 30, 50].includes(column)) {
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

  const addTable = (startColumn: number, group: ReviewGroup) => {
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

  setCell(8, 1, "Payment Clean", titleClass);
  setCell(9, 1, "Total Premium", redLabelClass);
  setCell(9, 2, formatMoney(data.totals.totalPayment), `${summaryClass} ${rightClass}`);
  setCell(8, 3, "Base Policy", titleClass);
  setCell(9, 3, formatMoney(data.totals.basePolicy), `${summaryClass} ${rightClass}`);
  setCell(8, 4, "Additional Policy", titleClass);
  setCell(9, 4, formatMoney(data.totals.additional), `${summaryClass} ${rightClass}`);
  setCell(8, 5, "Unclaim Payment", titleClass);
  setCell(9, 5, formatMoney(data.totals.unclaimed), `${summaryClass} ${rightClass}`);
  setCell(8, 6, "Sum Check", titleClass);
  setCell(
    9,
    6,
    data.totals.balanced ? "TRUE" : "FALSE",
    data.totals.balanced
      ? "bg-white text-center font-bold text-[#15803d]"
      : "bg-white text-center font-bold text-[#b91c1c]"
  );

  setCell(8, 8, "Policy In Month Report", titleClass);
  setCell(9, 8, "Total Premium", redLabelClass);
  setCell(9, 9, formatMoney(data.totals.basePolicy), `${summaryClass} ${rightClass}`);
  setCell(8, 30, "Additional Policy", titleClass);
  setCell(9, 30, "Total Premium", redLabelClass);
  setCell(9, 31, formatMoney(data.totals.additional), `${summaryClass} ${rightClass}`);
  setCell(8, 50, "Unclaim Payment", titleClass);
  setCell(9, 50, "Total Premium", redLabelClass);
  setCell(9, 51, formatMoney(data.totals.unclaimed), `${summaryClass} ${rightClass}`);

  addTable(1, data.paymentClean);
  addTable(8, data.policyInMonth);
  addTable(30, data.additionalPolicy);
  addTable(50, data.unclaimPayment);

  const maxDataRows = Math.max(
    data.paymentClean.rows.length,
    data.policyInMonth.rows.length,
    data.additionalPolicy.rows.length,
    data.unclaimPayment.rows.length
  );

  return {
    cells,
    maxRow: Math.max(10, 10 + maxDataRows),
  };
}

function ExcelSheetPreview({ data }: { data: ReportPreviewData }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { cells, maxRow } = useMemo(
    () => buildExcelPreviewCells(data),
    [data]
  );
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
      label: "Payment Clean",
      rows: data.paymentClean.count,
      total: data.totals.totalPayment,
    },
    {
      column: 8,
      label: "Policy In Month",
      rows: data.policyInMonth.count,
      total: data.totals.basePolicy,
    },
    {
      column: 30,
      label: "Additional",
      rows: data.additionalPolicy.count,
      total: data.totals.additional,
    },
    {
      column: 50,
      label: "Unclaim",
      rows: data.unclaimPayment.count,
      total: data.totals.unclaimed,
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
                    } ${
                      cell?.className ?? ""
                    }`}
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
            {data ? "P&C_Statement_Result" : "Building report preview"}
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

export default function PcStatementClient() {
  const [paymentFiles, setPaymentFiles] = useState<PaymentFileInput[]>([
    createPaymentFileInput(),
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [activeReviewTab, setActiveReviewTab] =
    useState<ReviewTab>("oldPolicies");
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [reportPreview, setReportPreview] = useState<ReportPreviewData | null>(
    null
  );
  const [totals, setTotals] = useState(emptyTotals);
  const [error, setError] = useState<string | null>(null);

  const canRun = useMemo(
    () => paymentFiles.length > 0 && paymentFiles.every((item) => item.file),
    [paymentFiles]
  );
  const selectedFileCount = paymentFiles.filter((item) => item.file).length;
  const status = isBalanced(totals.allPaymentsRaw, totals.final);
  const activeGroup = reviewData?.[activeReviewTab] ?? null;

  const buildPayloadFromFiles = (files: PaymentFileInput[]) => {
    const payload = new FormData();
    files.forEach((item) => {
      if (item.file) payload.append("files", item.file);
    });
    return payload;
  };

  const applyReviewData = (data: ReviewData) => {
    setReviewData(data);
    setTotals({
      allPaymentsRaw: data.totals.totalPayment,
      basePolicy: data.totals.basePolicy,
      additional: data.totals.additional,
      unclaimed: data.totals.unclaimed,
      final: data.totals.final,
    });
  };

  const loadReviewForFiles = async (files: PaymentFileInput[]) => {
    setIsLoadingReview(true);
    setError(null);

    try {
      const response = await fetch("/api/automation/pc-statement/review", {
        method: "POST",
        body: buildPayloadFromFiles(files),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Load review failed");
      }

      applyReviewData((await response.json()) as ReviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load review failed");
    } finally {
      setIsLoadingReview(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadInitialReview = async () => {
      setIsLoadingReview(true);
      setError(null);

      try {
        const response = await fetch("/api/automation/pc-statement/review", {
          method: "POST",
          body: new FormData(),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(data?.error ?? "Load review failed");
        }

        const data = (await response.json()) as ReviewData;
        if (!isMounted) return;
        applyReviewData(data);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Load review failed");
      } finally {
        if (isMounted) setIsLoadingReview(false);
      }
    };

    void loadInitialReview();

    return () => {
      isMounted = false;
    };
  }, []);

  const updatePaymentFile = (id: string, file: File | null) => {
    const nextFiles = paymentFiles.map((item) =>
      item.id === id ? { ...item, file } : item
    );

    setReviewData(null);
    setReportPreview(null);
    setTotals(emptyTotals);
    setError(null);
    if (file) setActiveReviewTab("paymentClean");
    else if (selectedFileCount <= 1) setActiveReviewTab("oldPolicies");
    setPaymentFiles(nextFiles);
    void loadReviewForFiles(nextFiles);
  };

  const addPaymentFile = () => {
    setReportPreview(null);
    setError(null);
    setPaymentFiles((current) => [...current, createPaymentFileInput()]);
  };

  const removePaymentFile = (id: string) => {
    const nextFiles =
      paymentFiles.length === 1
        ? paymentFiles
        : paymentFiles.filter((item) => item.id !== id);

    setReviewData(null);
    setReportPreview(null);
    setTotals(emptyTotals);
    setError(null);
    if (
      selectedFileCount <= 1 &&
      paymentFiles.find((item) => item.id === id)?.file
    ) {
      setActiveReviewTab("oldPolicies");
    }
    setPaymentFiles(nextFiles);
    void loadReviewForFiles(nextFiles);
  };

  const buildFilePayload = () => {
    return buildPayloadFromFiles(paymentFiles);
  };

  const handleLoadReview = async () => {
    setIsLoadingReview(true);
    setError(null);

    try {
      const response = await fetch("/api/automation/pc-statement/review", {
        method: "POST",
        body: buildFilePayload(),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Load review failed");
      }

      const data = (await response.json()) as ReviewData;
      setReviewData(data);
      setTotals({
        allPaymentsRaw: data.totals.totalPayment,
        basePolicy: data.totals.basePolicy,
        additional: data.totals.additional,
        unclaimed: data.totals.unclaimed,
        final: data.totals.final,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load review failed");
    } finally {
      setIsLoadingReview(false);
    }
  };

  const selectReviewTab = (tab: ReviewTab) => {
    setActiveReviewTab(tab);
    if (!reviewData && !isLoadingReview) {
      void handleLoadReview();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRun) return;

    setIsRunning(true);
    setReportPreview(null);
    setError(null);

    try {
      const response = await fetch("/api/automation/pc-statement/report-preview", {
        method: "POST",
        body: buildFilePayload(),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Build preview failed");
      }

      const data = (await response.json()) as ReportPreviewData;
      setReportPreview(data);
      setTotals({
        allPaymentsRaw: data.totals.totalPayment,
        basePolicy: data.totals.basePolicy,
        additional: data.totals.additional,
        unclaimed: data.totals.unclaimed,
        final: data.totals.final,
      });
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
      const response = await fetch("/api/automation/pc-statement/run", {
        method: "POST",
        body: buildFilePayload(),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Create Excel failed");
      }

      await downloadResponseFile(response, "pc-statement-report.xlsx");
      setTotals({
        allPaymentsRaw: readNumberHeader(response, "x-total-payment"),
        basePolicy: readNumberHeader(response, "x-base-policy"),
        additional: readNumberHeader(response, "x-additional"),
        unclaimed: readNumberHeader(response, "x-unclaimed"),
        final: readNumberHeader(response, "x-final"),
      });
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
                        Payment file
                      </span>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={(event) =>
                          updatePaymentFile(
                            item.id,
                            event.target.files?.[0] ?? null
                          )
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
                  Files
                </dt>
                <dd className="mt-1 truncate text-sm text-[#16233a]">
                  {selectedFileCount || "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
                  Last Black Line
                </dt>
                <dd className="mt-1 truncate text-sm text-[#16233a]">
                  {reportPreview?.lastBlackRow ?? reviewData?.lastBlackRow ?? "-"}
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
                  <div className="px-3 py-2">All Payments Raw</div>
                  <div className="px-3 py-2">Base Policy</div>
                  <div className="px-3 py-2">Additional</div>
                  <div className="px-3 py-2">Unclaimed</div>
                  <div className="px-3 py-2">Final</div>
                </div>
                <div className="grid grid-cols-5 border-t border-[#e6ebf2] text-sm font-semibold text-[#16233a]">
                  <div className="px-3 py-3">
                    {formatMoney(totals.allPaymentsRaw)}
                  </div>
                  <div className="px-3 py-3">{formatMoney(totals.basePolicy)}</div>
                  <div className="px-3 py-3">{formatMoney(totals.additional)}</div>
                  <div className="px-3 py-3">{formatMoney(totals.unclaimed)}</div>
                  <div className="px-3 py-3">{formatMoney(totals.final)}</div>
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

      <section className="rounded-lg border border-[#d8dee7] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e6ebf2] px-6 py-5">
          <div>
            <h2 className="text-base font-semibold text-[#16233a]">Review</h2>
            <p className="mt-1 text-sm text-[#667085]">
              {activeGroup ? `${activeGroup.count} row(s)` : "Not loaded"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLoadReview}
            disabled={isLoadingReview}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[#cfd7e3] px-4 text-sm font-semibold text-[#245a94] transition hover:bg-[#f3f6fa] disabled:cursor-not-allowed disabled:text-[#98a2b3]"
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={isLoadingReview ? "animate-spin" : ""}
            />
            {isLoadingReview ? "Loading..." : "Load Review"}
          </button>
        </div>

        <div className="border-b border-[#e6ebf2] px-6 py-4">
          <div className="flex gap-2 overflow-x-auto">
            {reviewTabs.map((tab) => {
              const isActive = activeReviewTab === tab.key;
              const count = reviewData?.[tab.key]?.count;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => selectReviewTab(tab.key)}
                  className={`h-9 whitespace-nowrap rounded-md border px-3 text-sm font-semibold transition ${
                    isActive
                      ? "border-[#245a94] bg-[#245a94] text-white"
                      : "border-[#cfd7e3] bg-white text-[#245a94] hover:bg-[#f3f6fa]"
                  }`}
                >
                  {tab.label}
                  {count !== undefined ? ` (${count})` : ""}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-6">
          <ReviewTable group={activeGroup} isLoading={isLoadingReview} />
        </div>
      </section>
    </div>
  );
}

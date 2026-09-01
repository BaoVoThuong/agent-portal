"use client";

import * as XLSX from "xlsx";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { resolveDialogProduct } from "@/lib/leads/create";
import { useBodyScrollLock } from "../../_shared/useBodyScrollLock";
import {
  fetchLeadEvents,
  peekLeadEvents,
  primeLeadEvent,
  type LeadEventOption as LeadEvent,
} from "@/lib/leads/events-cache";
import { TaskSelect } from "../../tasks/_components/TaskSelect";
import {
  parseLeadRows,
  type LeadColumnMapping,
  type ParseResult,
} from "@/lib/leads/import-parse";

const MAX_BYTES = 5 * 1024 * 1024;

const IMPORT_SELECT_BUTTON_CLASS =
  "!h-10 !rounded !border-2 !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";

type ImportResult = {
  inserted: number;
  duplicates: number;
  skipped: { row: number; reason: string }[];
  autoAssign: {
    assigned: number;
    unassigned: number;
    reason?: string;
  } | null;
};

type WeightPreview = {
  /** Kèm product để một response về trễ của product cũ không hiện nhầm. */
  product: "pc" | "health";
  enabled: boolean;
  preview: { email: string; count: number }[];
};

type LeadImportDialogProps = {
  open: boolean;
  /** null = màn hình đang xem mọi product, dialog phải hỏi. */
  productFilter: "pc" | "health" | null;
  sourceId: string;
  onClose: () => void;
  onImported: () => Promise<void>;
};

function guessColumn(headers: string[], pattern: RegExp): string | undefined {
  return headers.find((header) => pattern.test(header));
}

function formatEvent(event: LeadEvent): string {
  return event.event_date ? `${event.name} · ${event.event_date}` : event.name;
}

export function LeadImportDialog({
  open,
  productFilter,
  sourceId,
  onClose,
  onImported,
}: LeadImportDialogProps) {
  const [events, setEvents] = useState<LeadEvent[]>(
    () => peekLeadEvents()?.events ?? [],
  );
  const [eventsState, setEventsState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [eventId, setEventId] = useState("");
  const [newEventName, setNewEventName] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventsTruncated, setEventsTruncated] = useState(
    () => peekLeadEvents()?.truncated ?? false,
  );
  const [chosenProduct, setChosenProduct] = useState<"pc" | "health" | null>(null);
  const product = resolveDialogProduct(productFilter, chosenProduct);
  const [file, setFile] = useState<File | null>(null);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<LeadColumnMapping>({ phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [autoAssign, setAutoAssign] = useState(false);
  const [weightPreview, setWeightPreview] = useState<WeightPreview | null>(null);

  useEffect(() => {
    if (!open || eventsState !== "idle") return;
    void fetchLeadEvents()
      .then((payload) => {
        setEvents(payload.events);
        setEventsTruncated(payload.truncated);
        setEventsState("ready");
      })
      .catch(() => setEventsState("error"));
  }, [eventsState, open]);

  // Xem trước tỉ lệ ngay trong dialog: người bấm import phải thấy điều sắp xảy
  // ra trước khi nó xảy ra với 2.000 dòng.
  useEffect(() => {
    if (!open || !product) return;
    let cancelled = false;
    void fetch(`/api/leads/assignment-weights?product=${product}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (cancelled || !response.ok) return;
        setWeightPreview({
          product,
          enabled: payload?.enabled === true,
          preview: Array.isArray(payload?.preview) ? payload.preview : [],
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, product]);

  const preview = useMemo<ParseResult>(
    () => parseLeadRows(records.slice(0, 5), mapping),
    [mapping, records],
  );

  function resetAndClose() {
    setResult(null);
    setError(null);
    setFile(null);
    setRecords([]);
    setHeaders([]);
    setMapping({ phone: "" });
    setChosenProduct(null);
    setEventId("");
    setNewEventName("");
    setNewEventDate("");
    setEventsState("idle");
    onClose();
  }

  async function createEvent() {
    const name = newEventName.trim();
    if (!name || creatingEvent) return;
    setCreatingEvent(true);
    setError(null);
    try {
      const response = await fetch("/api/leads/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-lead-client-source": sourceId,
        },
        body: JSON.stringify({ name, event_date: newEventDate || null }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? "Could not create event.");
      const created = payload.event as LeadEvent;
      // Đẩy vào cache dùng chung, nếu không sự kiện vừa tạo ở đây sẽ không có
      // trong dialog Add cho tới khi tải lại trang.
      primeLeadEvent(created);
      setEvents((current) => [created, ...current]);
      setEventId(created.id);
      setNewEventName("");
      setNewEventDate("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create event.",
      );
    } finally {
      setCreatingEvent(false);
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setError(null);
    setResult(null);
    if (!nextFile) return;
    if (nextFile.size > MAX_BYTES) {
      setFile(null);
      setRecords([]);
      setHeaders([]);
      setError("That file is larger than 5 MB.");
      return;
    }
    try {
      const workbook = XLSX.read(await nextFile.arrayBuffer(), {
        type: "array",
      });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("That file has no sheets.");
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: null,
      });
      const firstRow = matrix[0] ?? [];
      const nextHeaders = firstRow
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
      if (nextHeaders.length === 0)
        throw new Error("The first row must contain column headers.");
      const nextRecords = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        sheet,
        { defval: null },
      );
      const nextPhone = guessColumn(nextHeaders, /phone|cell|mobile/i) ?? "";
      setFile(nextFile);
      setHeaders(nextHeaders);
      setRecords(nextRecords);
      setMapping({
        full_name: guessColumn(nextHeaders, /name/i),
        phone: nextPhone,
        email: guessColumn(nextHeaders, /e-?mail/i),
      });
    } catch (readError) {
      setFile(null);
      setRecords([]);
      setHeaders([]);
      setError(
        readError instanceof Error
          ? readError.message
          : "That file could not be read.",
      );
    }
  }

  async function importFile() {
    if (!file || !eventId || !mapping.phone || importing) return;
    setImporting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("event_id", eventId);
      form.set("product", product ?? "");
      form.set("auto_assign", autoAssign ? "true" : "false");
      form.set("mapping", JSON.stringify(mapping));
      const response = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "x-lead-client-source": sourceId },
        body: form,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? "Could not import leads.");
      setResult(payload as ImportResult);
      await onImported();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import leads.",
      );
    } finally {
      setImporting(false);
    }
  }

  useBodyScrollLock(open);
  if (!open) return null;
  const canImport = Boolean(
    eventId && file && mapping.phone && preview.rows.length > 0 && !importing,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Import leads"
    >
      <div className="flex h-[calc(100vh-2rem)] max-h-[760px] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#e9f2ff] text-[#0c66e4]">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-[#172b4d]">
                Import leads
              </h2>
              <p className="mt-1 text-sm text-[#626f86]">
                Spreadsheet limit: 2,000 rows and 5 MB.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
            onClick={resetAndClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <section className="border border-[#dbe2eb] bg-white p-4 shadow-[0_1px_2px_rgba(22,35,58,0.04)]">
              {productFilter ? null : (
                <div className="mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[#667085]">
                    Product (optional)
                  </h3>
                  <TaskSelect
                    label="Product"
                    value={chosenProduct ?? ""}
                    options={[
                      { value: "", label: "Not specified" },
                      { value: "pc", label: "P&C" },
                      { value: "health", label: "Health" },
                    ]}
                    placeholder="Choose product…"
                    className="mt-2 w-full"
                    buttonClassName={IMPORT_SELECT_BUTTON_CLASS}
                    onChange={(value) =>
                      setChosenProduct(
                        value === "pc" || value === "health" ? value : null,
                      )
                    }
                  />
                </div>
              )}
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[#667085]">
                1. Choose an event
              </h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <TaskSelect
                  label="event"
                  value={eventId}
                  options={events.map((event) => ({
                    value: event.id,
                    label: formatEvent(event),
                  }))}
                  placeholder={
                    eventsState === "loading" || eventsState === "idle"
                      ? "Loading events..."
                      : "Choose event"
                  }
                  searchable
                  menuClassName="max-h-64 min-w-full"
                  buttonClassName={IMPORT_SELECT_BUTTON_CLASS}
                  onChange={setEventId}
                  disabled={eventsState === "loading" || eventsState === "idle"}
                />
                {eventsTruncated ? (
                  // Danh sách bị cắt ở 200. Không nói ra thì người dùng tưởng
                  // sự kiện của mình chưa được tạo và đi tạo trùng một cái nữa.
                  <p className="mt-1 text-xs font-semibold text-[#974f0c]">
                    Showing the 200 most recent events. If yours is not here,
                    create it below using its exact name — matching is
                    case-insensitive, so it joins the existing event rather than
                    making a duplicate.
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <input
                    className="h-10 min-w-0 rounded border-2 border-[#dfe1e6] px-3 text-sm outline-none focus:border-[#0c66e4]"
                    placeholder="New event name"
                    value={newEventName}
                    onChange={(event) => setNewEventName(event.target.value)}
                  />
                  <input
                    className="h-10 rounded border-2 border-[#dfe1e6] px-3 text-sm outline-none focus:border-[#0c66e4]"
                    type="date"
                    value={newEventDate}
                    onChange={(event) => setNewEventDate(event.target.value)}
                  />
                  <button
                    type="button"
                    className="inline-flex h-10 items-center rounded border border-[#cfd8e5] bg-white px-3 text-sm font-bold text-[#344054] transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void createEvent()}
                    disabled={!newEventName.trim() || creatingEvent}
                  >
                    Create
                  </button>
                </div>
              </div>
              {eventsState === "error" && (
                <p className="mt-2 text-xs font-semibold text-red-700">
                  Could not load events.
                </p>
              )}
            </section>

            <section className="border border-[#dbe2eb] bg-white p-4 shadow-[0_1px_2px_rgba(22,35,58,0.04)]">
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[#667085]">
                2. Choose a file and map columns
              </h3>
              <label className="mt-3 flex cursor-pointer items-center gap-3 border border-dashed border-[#9fb3ca] bg-[#f7f9fc] px-4 py-5 text-sm font-semibold text-[#42526e] transition hover:border-[#0c66e4] hover:bg-[#f0f6ff]">
                <Upload className="h-5 w-5 shrink-0 text-[#0c66e4]" />
                <span>Choose an Excel or CSV file</span>
                <input
                  className="sr-only"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => void handleFile(event)}
                />
              </label>
              {file && (
                <p className="mt-2 text-xs text-[#6b778c]">
                  {file.name} · {records.length.toLocaleString()} data rows
                </p>
              )}
              {headers.length > 0 && (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {(["full_name", "phone", "email"] as const).map((field) => (
                    <label key={field} className="block">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#667085]">
                        {field === "full_name" ? "Full name" : field}
                      </span>
                      <TaskSelect
                        label={field === "full_name" ? "Full name" : field}
                        value={mapping[field] ?? ""}
                        options={headers.map((header) => ({
                          value: header,
                          label: header,
                        }))}
                        placeholder="Not mapped"
                        searchable
                        className="mt-1 w-full"
                        buttonClassName={IMPORT_SELECT_BUTTON_CLASS}
                        menuClassName="max-h-64 min-w-full"
                        onChange={(value) =>
                          setMapping((current) => ({
                            ...current,
                            [field]: value || undefined,
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </section>

            {headers.length > 0 && (
              <section className="border border-[#dbe2eb] bg-white p-4 shadow-[0_1px_2px_rgba(22,35,58,0.04)]">
                <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[#667085]">
                  3. Preview and import
                </h3>
                <div className="mt-3 overflow-x-auto border border-[#dfe1e6]">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-[#f8fafc] text-[10px] font-bold uppercase tracking-[0.06em] text-[#667085]">
                      <tr>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Phone</th>
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">Custom values</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eef1f5]">
                      {preview.rows.map((row, index) => (
                        <tr key={`${row.phone}-${index}`}>
                          <td className="px-3 py-2">{row.full_name ?? "—"}</td>
                          <td className="px-3 py-2">{row.phone}</td>
                          <td className="px-3 py-2">{row.email ?? "—"}</td>
                          <td className="px-3 py-2">
                            {Object.keys(row.custom_values).join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                      {preview.rows.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-3 py-4 text-center text-[#6b778c]"
                          >
                            No valid rows in preview. Map a usable phone column.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {weightPreview?.enabled && weightPreview.product === product ? (
                  <label className="mt-3 flex items-start gap-2 rounded border border-[#dfe1e6] bg-white p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={autoAssign}
                      onChange={(event) => setAutoAssign(event.target.checked)}
                    />
                    <span>
                      <span className="font-semibold text-[#172b4d]">
                        Auto-assign these leads by ratio
                      </span>
                      {weightPreview.preview.length > 0 ? (
                        <span className="mt-0.5 block text-xs text-[#6b778c]">
                          Next 10 leads:{" "}
                          {weightPreview.preview
                            .map((row) => `${row.email.split("@")[0]} ${row.count}`)
                            .join(" · ")}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-xs text-[#974f0c]">
                          Nobody is set to receive this product — these leads will stay in the pool.
                        </span>
                      )}
                    </span>
                  </label>
                ) : null}
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void importFile()}
                    disabled={!canImport}
                  >
                    <Upload className="h-4 w-4" />
                    {importing ? "Importing..." : "Import leads"}
                  </button>
                </div>
              </section>
            )}

            {error && (
              <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                {error}
              </p>
            )}
            {result && (
              <section className="border border-emerald-200 bg-emerald-50 p-4">
                <h3 className="font-semibold text-emerald-900">
                  Import result
                </h3>
                <div className="mt-2 grid gap-2 text-sm text-emerald-900 sm:grid-cols-3">
                  <span>
                    Inserted: <strong>{result.inserted}</strong>
                  </span>
                  <span>
                    Duplicates: <strong>{result.duplicates}</strong>
                  </span>
                  <span>
                    Skipped: <strong>{result.skipped.length}</strong>
                  </span>
                </div>
                {result.autoAssign ? (
                  <p className="mt-2 text-sm text-emerald-900">
                    Assigned: <strong>{result.autoAssign.assigned}</strong>
                    {result.autoAssign.unassigned > 0 ? (
                      <>
                        {" · left in the pool: "}
                        <strong>{result.autoAssign.unassigned}</strong>
                        {result.autoAssign.reason ? ` — ${result.autoAssign.reason}` : null}
                      </>
                    ) : null}
                  </p>
                ) : null}
                {result.skipped.length > 0 && (
                  <div className="mt-3 overflow-x-auto border border-emerald-200 bg-white">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-[#f8fafc] text-emerald-900">
                        <tr>
                          <th className="px-3 py-2">Excel row</th>
                          <th className="px-3 py-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-100">
                        {result.skipped.map((row) => (
                          <tr key={`${row.row}-${row.reason}`}>
                            <td className="px-3 py-2">{row.row}</td>
                            <td className="px-3 py-2">{row.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

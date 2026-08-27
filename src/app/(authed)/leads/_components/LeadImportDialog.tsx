"use client";

import * as XLSX from "xlsx";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { parseLeadRows, type LeadColumnMapping, type ParseResult } from "@/lib/leads/import-parse";

const MAX_BYTES = 5 * 1024 * 1024;

type LeadEvent = {
  id: string;
  name: string;
  event_date: string | null;
  location?: string | null;
};

type ImportResult = {
  inserted: number;
  duplicates: number;
  skipped: { row: number; reason: string }[];
};

type LeadImportDialogProps = {
  open: boolean;
  product: "pc" | "health";
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
  product,
  sourceId,
  onClose,
  onImported,
}: LeadImportDialogProps) {
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [eventsState, setEventsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [eventId, setEventId] = useState("");
  const [newEventName, setNewEventName] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<LeadColumnMapping>({ phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (!open || eventsState !== "idle") return;
    setEventsState("loading");
    void fetch("/api/leads/events", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? "Could not load events.");
        setEvents(Array.isArray(payload?.events) ? payload.events as LeadEvent[] : []);
        setEventsState("ready");
      })
      .catch(() => setEventsState("error"));
  }, [eventsState, open]);

  const preview = useMemo<ParseResult>(
    () => parseLeadRows(records.slice(0, 5), mapping),
    [mapping, records]
  );

  function resetAndClose() {
    setResult(null);
    setError(null);
    setFile(null);
    setRecords([]);
    setHeaders([]);
    setMapping({ phone: "" });
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
        headers: { "Content-Type": "application/json", "x-lead-client-source": sourceId },
        body: JSON.stringify({ name, event_date: newEventDate || null }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not create event.");
      const created = payload.event as LeadEvent;
      setEvents((current) => [created, ...current]);
      setEventId(created.id);
      setNewEventName("");
      setNewEventDate("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create event.");
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
      const workbook = XLSX.read(await nextFile.arrayBuffer(), { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("That file has no sheets.");
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
      const firstRow = matrix[0] ?? [];
      const nextHeaders = firstRow.map((value) => String(value ?? "").trim()).filter(Boolean);
      if (nextHeaders.length === 0) throw new Error("The first row must contain column headers.");
      const nextRecords = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
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
      setError(readError instanceof Error ? readError.message : "That file could not be read.");
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
      form.set("product", product);
      form.set("mapping", JSON.stringify(mapping));
      const response = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "x-lead-client-source": sourceId },
        body: form,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not import leads.");
      setResult(payload as ImportResult);
      await onImported();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Could not import leads.");
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;
  const canImport = Boolean(eventId && file && mapping.phone && preview.rows.length > 0 && !importing);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Import leads">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-[#e6eaf0] px-6 py-5">
          <div><h2 className="text-xl font-semibold text-[#172b4d]">Import leads</h2><p className="mt-1 text-sm text-[#6b778c]">Spreadsheet limit: 2,000 rows and 5 MB.</p></div>
          <button type="button" className="text-sm font-semibold text-[#6b778c] hover:text-[#172b4d]" onClick={resetAndClose}>Close</button>
        </header>
        <div className="space-y-6 px-6 py-6">
          <section>
            <h3 className="text-sm font-bold text-[#172b4d]">1. Choose an event</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <select className="rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm" value={eventId} onChange={(event) => setEventId(event.target.value)} disabled={eventsState === "loading"}>
                <option value="">{eventsState === "loading" ? "Loading events..." : "Choose event"}</option>
                {events.map((event) => <option key={event.id} value={event.id}>{formatEvent(event)}</option>)}
              </select>
              <div className="flex gap-2">
                <input className="min-w-0 rounded-md border border-[#cfd8e5] px-3 py-2 text-sm" placeholder="New event name" value={newEventName} onChange={(event) => setNewEventName(event.target.value)} />
                <input className="rounded-md border border-[#cfd8e5] px-3 py-2 text-sm" type="date" value={newEventDate} onChange={(event) => setNewEventDate(event.target.value)} />
                <button type="button" className="rounded-md border border-[#cfd8e5] px-3 py-2 text-sm font-semibold text-[#172b4d] disabled:opacity-40" onClick={() => void createEvent()} disabled={!newEventName.trim() || creatingEvent}>Create</button>
              </div>
            </div>
            {eventsState === "error" && <p className="mt-2 text-xs font-semibold text-red-700">Could not load events.</p>}
          </section>

          <section>
            <h3 className="text-sm font-bold text-[#172b4d]">2. Choose a file and map columns</h3>
            <input className="mt-2 block w-full rounded-md border border-dashed border-[#b8c4d4] bg-[#f7f8fa] px-3 py-4 text-sm" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void handleFile(event)} />
            {file && <p className="mt-2 text-xs text-[#6b778c]">{file.name} · {records.length.toLocaleString()} data rows</p>}
            {headers.length > 0 && <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {(["full_name", "phone", "email"] as const).map((field) => <label key={field} className="block"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b778c]">{field === "full_name" ? "Full name" : field}</span><select className="mt-1 w-full rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm" value={mapping[field] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value || undefined }))}><option value="">Not mapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}
            </div>}
          </section>

          {headers.length > 0 && <section>
            <h3 className="text-sm font-bold text-[#172b4d]">3. Preview and import</h3>
            <div className="mt-2 overflow-x-auto rounded-md border border-[#e6eaf0]"><table className="min-w-full text-left text-xs"><thead className="bg-[#f7f8fa] text-[#6b778c]"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Custom values</th></tr></thead><tbody className="divide-y divide-[#e6eaf0]">{preview.rows.map((row, index) => <tr key={`${row.phone}-${index}`}><td className="px-3 py-2">{row.full_name ?? "—"}</td><td className="px-3 py-2">{row.phone}</td><td className="px-3 py-2">{row.email ?? "—"}</td><td className="px-3 py-2">{Object.keys(row.custom_values).join(", ") || "—"}</td></tr>)}{preview.rows.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-[#6b778c]">No valid rows in preview. Map a usable phone column.</td></tr>}</tbody></table></div>
            <div className="mt-3 flex justify-end"><button type="button" className="rounded-md bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void importFile()} disabled={!canImport}>{importing ? "Importing..." : "Import leads"}</button></div>
          </section>}

          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
          {result && <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"><h3 className="font-semibold text-emerald-900">Import result</h3><div className="mt-2 grid gap-2 text-sm text-emerald-900 sm:grid-cols-3"><span>Inserted: <strong>{result.inserted}</strong></span><span>Duplicates: <strong>{result.duplicates}</strong></span><span>Skipped: <strong>{result.skipped.length}</strong></span></div>{result.skipped.length > 0 && <div className="mt-3 overflow-x-auto rounded-md border border-emerald-200 bg-white"><table className="min-w-full text-left text-xs"><thead className="text-emerald-900"><tr><th className="px-3 py-2">Excel row</th><th className="px-3 py-2">Reason</th></tr></thead><tbody className="divide-y divide-emerald-100">{result.skipped.map((row) => <tr key={`${row.row}-${row.reason}`}><td className="px-3 py-2">{row.row}</td><td className="px-3 py-2">{row.reason}</td></tr>)}</tbody></table></div>}</section>}
        </div>
      </div>
    </div>
  );
}

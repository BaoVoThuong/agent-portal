"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";
import {
  fetchLeadEvents,
  peekLeadEvents,
  type LeadEventOption as LeadEvent,
} from "@/lib/leads/events-cache";
import { leadDisplayKey } from "@/lib/leads/display";
import { normalizeEventName } from "@/lib/leads/events";
import type { ExistingMatchField } from "@/lib/leads/import-existing";
import {
  LEAD_IMPORT_TEMPLATE,
  leadImportTemplateCsv,
} from "@/lib/leads/import-template";
import type {
  LeadImportPreview,
  LeadImportResult,
  UnmatchedImportAgent,
} from "@/lib/leads/import-types";
import {
  isPersonalLeadEventName,
  LEAD_TYPE_LABEL,
  LEAD_TYPES,
  type LeadType,
} from "@/lib/leads/lead-type";
import { useDebouncedValue } from "@/lib/leads/use-debounced-value";
import { personLabel } from "@/lib/tasks/people";

// Khớp trần của route: Vercel chặn body trên 4.5 MB trước khi tới server.
const MAX_BYTES = 4 * 1024 * 1024;
const MATCH_FIELD_LABEL: Record<ExistingMatchField, string> = {
  name: "name",
  phone: "phone",
  email: "email",
  fub: "FUB link",
};

const IMPORT_INPUT_CLASS =
  "h-10 w-full rounded border-2 border-[#dfe1e6] px-3 text-sm text-[#172b4d] outline-none transition focus:border-[#0c66e4]";
const SECTION_CLASS =
  "border border-[#dbe2eb] bg-white p-4 shadow-[0_1px_2px_rgba(22,35,58,0.04)]";
const SECTION_TITLE_CLASS =
  "text-xs font-bold uppercase tracking-[0.08em] text-[#667085]";

type WeightPreview = {
  eventId: string;
  enabled: boolean;
  preview: { email: string; count: number }[];
};

type LeadImportDialogProps = {
  open: boolean;
  /** Tên hiển thị theo email — để preview ghi tên người giữ lead, không ghi email. */
  nameByEmail: Map<string, string>;
  sourceId: string;
  onClose: () => void;
  /** Nhận tóm tắt để màn hình ngoài báo toast; modal tự đóng khi lượt import sạch. */
  onImported: (result: LeadImportResult) => Promise<void>;
};

function formatEvent(event: LeadEvent): string {
  return event.event_date ? `${event.name} · ${event.event_date}` : event.name;
}

function rowList(rows: readonly number[]): string {
  const shown = rows.slice(0, 8).join(", ");
  return rows.length > 8 ? `${shown} and ${rows.length - 8} more` : shown;
}

function unmatchedAgentText(agent: UnmatchedImportAgent): string {
  if (agent.status === "not-agent") {
    return `${agent.accountName ?? agent.name} has an account but is not an Agent in Account Management → Agent membership`;
  }
  if (agent.status === "ambiguous") {
    return `matches more than one account (${agent.candidates.join(", ")})`;
  }
  return "no account with this name";
}

function downloadTemplate() {
  const url = URL.createObjectURL(
    new Blob([leadImportTemplateCsv()], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "lead-import-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function LeadImportDialog({
  open,
  nameByEmail,
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
  // Event lead là mặc định (user chốt 2026-10-04: import gần như luôn là danh
  // sách của một sự kiện). Event lead thì GÕ tên event (khai báo) — không có
  // bước tạo: tên chưa có thì Import tạo luôn.
  const [leadType, setLeadType] = useState<LeadType>("event");
  const [eventName, setEventName] = useState("");
  const [eventsTruncated, setEventsTruncated] = useState(
    () => peekLeadEvents()?.truncated ?? false,
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LeadImportPreview | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  /** Dòng khách cũ người dùng tick "Remove". */
  const [removedRows, setRemovedRows] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<LeadImportResult | null>(null);
  const [autoAssign, setAutoAssign] = useState(false);
  const [weightPreview, setWeightPreview] = useState<WeightPreview | null>(null);
  const previewSequenceRef = useRef(0);
  const isPersonal = leadType === "personal";
  // Chạy thử lại theo tên đã ngừng gõ, không theo từng phím.
  const typedEventName = normalizeEventName(useDebouncedValue(eventName, 400));
  const eventNameForPreview = isPersonal ? "" : typedEventName;
  const eventNameInvalid = !isPersonal && isPersonalLeadEventName(typedEventName);
  // Tên trùng (không phân biệt hoa thường) một event có sẵn thì lấy id của nó
  // để xem trước tỉ lệ chia; cùng cách so với server.
  const matchedEvent = eventNameForPreview
    ? events.find(
        (event) => event.name.toLowerCase() === eventNameForPreview.toLowerCase(),
      ) ?? null
    : null;
  const eventId = matchedEvent?.id ?? "";
  const suggestedEvents = events.filter((event) => !isPersonalLeadEventName(event.name));

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
    if (!open || !eventId) return;
    let cancelled = false;
    void fetch(`/api/leads/assignment-weights?event_id=${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (cancelled || !response.ok) return;
        setWeightPreview({
          eventId,
          enabled: payload?.enabled === true,
          preview: Array.isArray(payload?.preview) ? payload.preview : [],
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  // Preview = chính route Import chạy thử (`dry_run`), nên preview nói gì thì
  // import làm đúng vậy. Gọi lại khi đổi Lead type / tên event: "trùng trong
  // cùng event" và luật Agent của Personal lead phụ thuộc hai thứ đó.
  useEffect(() => {
    if (!open || !file) return;
    // Event lead chưa có tên (hoặc gõ "Personal lead") thì chưa chạy thử.
    if (!isPersonal && (!eventNameForPreview || eventNameInvalid)) return;
    const sequence = ++previewSequenceRef.current;
    const form = new FormData();
    form.set("file", file);
    form.set("lead_type", leadType);
    form.set("event_name", eventNameForPreview);
    form.set("dry_run", "true");
    void Promise.resolve().then(async () => {
      setPreviewState("loading");
      try {
        const response = await fetch("/api/leads/import", {
          method: "POST",
          headers: { "x-lead-client-source": sourceId },
          body: form,
        });
        const payload = await response.json().catch(() => null);
        if (sequence !== previewSequenceRef.current) return;
        if (!response.ok) throw new Error(payload?.error ?? "Could not read that file.");
        const next = payload as LeadImportPreview;
        setPreview(next);
        // Bỏ tick của dòng không còn bỏ được (vd. vừa đổi event).
        const stillExisting = new Set(
          next.existingClients.filter((match) => match.removable).map((match) => match.row),
        );
        setRemovedRows((current) => new Set([...current].filter((row) => stillExisting.has(row))));
        setPreviewState("idle");
      } catch (previewError) {
        if (sequence !== previewSequenceRef.current) return;
        setPreview(null);
        setPreviewState("error");
        setError(previewError instanceof Error ? previewError.message : "Could not read that file.");
      }
    });
  }, [open, file, isPersonal, leadType, eventNameForPreview, eventNameInvalid, sourceId]);

  function resetAndClose() {
    previewSequenceRef.current += 1;
    setResult(null);
    setError(null);
    setFile(null);
    setPreview(null);
    setPreviewState("idle");
    setRemovedRows(new Set());
    setLeadType("event");
    setEventName("");
    setEventsState("idle");
    setAutoAssign(false);
    onClose();
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    event.target.value = "";
    setError(null);
    setResult(null);
    if (!nextFile) return;
    if (nextFile.size > MAX_BYTES) {
      setFile(null);
      setPreview(null);
      setError("That file is larger than 4 MB.");
      return;
    }
    setPreview(null);
    setRemovedRows(new Set());
    setFile(nextFile);
  }

  async function importFile() {
    if (!file || !preview || importing) return;
    setImporting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("lead_type", leadType);
      form.set("event_name", eventNameForPreview);
      form.set("auto_assign", eventId && autoAssign ? "true" : "false");
      form.set("exclude_rows", JSON.stringify([...removedRows]));
      const response = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "x-lead-client-source": sourceId },
        body: form,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? "Could not import leads.");
      const imported = payload as LeadImportResult;
      setResult(imported);
      await onImported(imported);
      // Lượt import SẠCH thì đóng modal và báo bằng toast. Còn dòng bị bỏ, số
      // trùng, cảnh báo hay Agent không khớp thì GIỮ modal: đó là thứ cần đọc.
      if (
        imported.skipped.length === 0 &&
        imported.duplicates === 0 &&
        imported.warnings.length === 0 &&
        imported.unmatchedAgents.length === 0 &&
        imported.ignoredColumns.length === 0
      ) {
        resetAndClose();
      }
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

  // Preview của Lead type / tên khác thì ẩn (so theo tên đã ngừng gõ để không
  // nháy khi đang gõ).
  const shownPreview =
    preview && preview.eventName === (isPersonal ? null : typedEventName || undefined)
      ? preview
      : null;
  const existingClients = shownPreview?.existingClients ?? [];
  // Dòng CHỈ trùng tên không bỏ được (user chốt 2026-10-03) — server cũng bỏ
  // qua tick của dòng đó.
  const removableRows = existingClients
    .filter((match) => match.removable && !match.sameEventBlocked)
    .map((match) => match.row);
  const removedCount = removableRows.filter((row) => removedRows.has(row)).length;
  const importCount = shownPreview ? Math.max(0, shownPreview.importable - removedCount) : 0;
  const existingRowSet = new Set(existingClients.map((match) => match.row));
  const presentHeaders = new Set(preview?.presentHeaders ?? []);
  // Preview phải khớp đúng tên đang gõ — gõ dở thì chưa cho import.
  const previewIsCurrent =
    preview !== null &&
    (isPersonal
      ? preview.eventName === null
      : preview.eventName === normalizeEventName(eventName));
  const canImport = Boolean(
    file && preview && previewIsCurrent && importCount > 0 && previewState !== "loading" && !importing,
  );
  const missingForImport = [
    !isPersonal && !normalizeEventName(eventName) ? "the event name" : null,
    !file ? "a file" : null,
    shownPreview && importCount === 0 ? "at least one row to import" : null,
  ].filter((item): item is string => item !== null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Import leads"
    >
      <div className="flex h-[calc(100vh-2rem)] max-h-[820px] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]">
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
                Uses the fixed lead template · up to 2,000 rows and 4 MB.
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
            <section className={SECTION_CLASS}>
              <h3 className={SECTION_TITLE_CLASS}>
                1. Lead type
                <span className="text-[#bf2600]" title="Required">{" *"}</span>
              </h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-[16rem_minmax(0,1fr)]">
                <div
                  role="radiogroup"
                  aria-label="Lead type"
                  className="grid h-10 grid-cols-2 gap-1 rounded border-2 border-[#dfe1e6] bg-white p-0.5"
                >
                  {LEAD_TYPES.map((type) => {
                    const selected = leadType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          setLeadType(type);
                          setAutoAssign(false);
                        }}
                        className={`rounded text-sm font-semibold transition ${
                          selected
                            ? "bg-[#e9f2ff] text-[#0c66e4]"
                            : "text-[#42526e] hover:bg-[#f4f5f7]"
                        }`}
                      >
                        {LEAD_TYPE_LABEL[type]}
                      </button>
                    );
                  })}
                </div>
                {isPersonal ? (
                  <p className="flex items-center text-xs font-medium text-[#626f86]">
                    Each row goes to the Agent named in its Agent column.
                  </p>
                ) : (
                  <div>
                    {/* Gõ tên = khai báo event. Danh sách chỉ là gợi ý; tên
                        chưa có thì Import tạo event đó. */}
                    <input
                      className={IMPORT_INPUT_CLASS}
                      list="lead-import-event-names"
                      value={eventName}
                      onChange={(event) => {
                        setEventName(event.target.value);
                        setAutoAssign(false);
                      }}
                      placeholder="Event name, e.g. Health Fair 2026"
                      aria-label="Event name"
                      autoFocus
                    />
                    <datalist id="lead-import-event-names">
                      {suggestedEvents.map((event) => (
                        <option key={event.id} value={event.name}>
                          {formatEvent(event)}
                        </option>
                      ))}
                    </datalist>
                  </div>
                )}
              </div>
              {!isPersonal && eventNameInvalid ? (
                <p className="mt-2 text-xs font-semibold text-[#bf2600]">
                  Personal leads have no event — choose Personal lead instead.
                </p>
              ) : !isPersonal && shownPreview ? (
                <p
                  className={`mt-2 text-xs font-semibold ${
                    shownPreview.eventIsNew ? "text-[#974f0c]" : "text-[#216e4e]"
                  }`}
                >
                  {shownPreview.eventIsNew
                    ? `New event — "${shownPreview.eventName}" will be created when you import.`
                    : `Existing event — leads join "${matchedEvent?.name ?? shownPreview.eventName}".`}
                </p>
              ) : null}
              {!isPersonal && eventsTruncated ? (
                // Gợi ý bị cắt ở 200; gõ đúng tên vẫn khớp event cũ.
                <p className="mt-2 text-xs font-medium text-[#6b778c]">
                  Suggestions show the 200 most recent events. Typing an older
                  event&apos;s exact name still adds to it — matching ignores case.
                </p>
              ) : null}
              {!isPersonal && eventsState === "error" ? (
                <p className="mt-2 text-xs font-semibold text-rose-700">
                  Could not load past events; you can still type a name.
                </p>
              ) : null}
            </section>

            <section className={SECTION_CLASS}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={SECTION_TITLE_CLASS}>
                  2. Choose a file
                  <span className="text-[#bf2600]" title="Required">{" *"}</span>
                </h3>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-[#cfd8e5] bg-white px-2.5 text-xs font-bold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download template
                </button>
              </div>
              <label
                className={`mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed transition ${
                  file
                    ? "border-[#c8d4e2] bg-white px-3 py-2.5 hover:border-[#0c66e4]"
                    : "border-[#9fb3ca] bg-[#f7f9fc] px-4 py-6 hover:border-[#0c66e4] hover:bg-[#f0f6ff]"
                }`}
              >
                {file ? (
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-[#0c66e4]" />
                ) : (
                  <Upload className="h-5 w-5 shrink-0 text-[#0c66e4]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#172b4d]">
                    {file ? file.name : "Choose an Excel or CSV file"}
                  </span>
                  <span className="block text-xs font-medium text-[#6b778c]">
                    {previewState === "loading"
                      ? "Checking the file…"
                      : preview
                        ? `Sheet "${preview.sheetName}" · ${preview.totalRows.toLocaleString()} rows`
                        : "First row must be the template's column headers"}
                  </span>
                </span>
                {file ? (
                  <span className="shrink-0 rounded border border-[#dfe1e6] px-2 py-1 text-xs font-bold text-[#42526e]">
                    Change
                  </span>
                ) : null}
                <input
                  className="sr-only"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFile}
                />
              </label>
              {/* Mẫu cột cố định: ✓ có trong file, ✗ thiếu một cột chắc chắn
                  phải có, gạch nối = cột tuỳ chọn (Agent, Note) không có. */}
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {LEAD_IMPORT_TEMPLATE.map((column) => {
                  const present = presentHeaders.has(column.header);
                  const missing = Boolean(preview) && !present && column.expected;
                  return (
                    <li
                      key={column.field}
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold ${
                        missing
                          ? "border-[#ffbdad] bg-[#ffebe6] text-[#bf2600]"
                          : present
                            ? "border-[#b3d4ff] bg-[#e9f2ff] text-[#0055cc]"
                            : "border-[#dfe1e6] bg-[#f7f8fa] text-[#6b778c]"
                      }`}
                    >
                      <span aria-hidden="true">{missing ? "✗" : present ? "✓" : "·"}</span>
                      {column.header}
                      {column.expected ? null : (
                        <span className="font-medium text-[#97a0af]">(optional)</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {shownPreview ? (
              <>
                {existingClients.length > 0 ? (
                  // Khách cũ: ĐỎ và lên ĐẦU (user chốt 2026-10-03). Tick là bỏ
                  // dòng khỏi lượt import; không tick thì vẫn import.
                  <section className="border border-[#ffbdad] bg-[#ffebe6] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-[#bf2600]">
                        Existing clients ({existingClients.length})
                      </h3>
                      {removableRows.length > 0 ? (
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setRemovedRows(new Set(removableRows))}
                            className="h-7 rounded border border-[#ff8f73] bg-white px-2 text-xs font-bold text-[#bf2600] transition hover:bg-[#fff4f2]"
                          >
                            Tick all
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemovedRows(new Set())}
                            className="h-7 rounded px-2 text-xs font-bold text-[#bf2600] transition hover:bg-white/60"
                          >
                            Clear
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs font-medium text-[#ae2a19]">
                      These rows match leads already in the system by name,
                      phone, email or FUB link. Tick a row to remove it from
                      this import. A match on name only is just a heads-up —
                      that row is always imported.
                    </p>
                    {shownPreview.existingCheckTruncated ? (
                      <p className="mt-1 text-xs font-semibold text-[#974f0c]">
                        Only the first 20,000 leads were checked.
                      </p>
                    ) : null}
                    <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                      {existingClients.map((match) => {
                        const removed = match.sameEventBlocked || removedRows.has(match.row);
                        const nameOnly = !match.removable && !match.sameEventBlocked;
                        return (
                          <li key={match.row}>
                            <label className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${
                              nameOnly ? "border-[#dfe1e6] bg-[#fafbfc]" : "border-[#ffd2c7] bg-white"
                            }`}>
                              <input
                                type="checkbox"
                                className={`mt-0.5 ${nameOnly ? "invisible" : ""}`}
                                checked={removed}
                                disabled={match.sameEventBlocked || nameOnly}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setRemovedRows((current) => {
                                    const next = new Set(current);
                                    if (checked) next.add(match.row);
                                    else next.delete(match.row);
                                    return next;
                                  });
                                }}
                                aria-label={`Remove row ${match.row} from this import`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className={`block font-semibold ${removed ? "text-[#97a0af] line-through" : "text-[#172b4d]"}`}>
                                  Row {match.row} · {match.name ?? "No name"}
                                </span>
                                {match.matches.map((hit) => (
                                  <span key={hit.leadId} className="block text-xs text-[#42526e]">
                                    {leadDisplayKey(hit.displayNumber)} · {hit.leadName ?? "No name"} ·{" "}
                                    {hit.eventName ?? "Personal lead"} ·{" "}
                                    {hit.owner ? personLabel(hit.owner, nameByEmail) : "Unassigned"} ·{" "}
                                    <span className="font-semibold text-[#bf2600]">
                                      matched on {hit.on.map((field) => MATCH_FIELD_LABEL[field]).join(", ")}
                                    </span>
                                  </span>
                                ))}
                                {match.sameEventBlocked ? (
                                  <span className="mt-0.5 block text-xs font-semibold text-[#bf2600]">
                                    Already in this event — it will not be imported again.
                                  </span>
                                ) : nameOnly ? (
                                  <span className="mt-0.5 block text-xs font-semibold text-[#626f86]">
                                    Same name only — this row will be imported.
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}

                <section className={SECTION_CLASS}>
                  <h3 className={SECTION_TITLE_CLASS}>3. Preview and import</h3>
                  <div className="mt-3 space-y-2 text-xs">
                    {shownPreview.missingHeaders.length > 0 ? (
                      <p className="rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 font-semibold text-[#bf2600]">
                        This file is missing {shownPreview.missingHeaders.join(", ")}.
                        Check that it uses the lead template — those columns
                        will be empty.
                      </p>
                    ) : null}
                    {shownPreview.ignoredColumns.length > 0 ? (
                      <p className="rounded border border-[#f5cd47] bg-[#fff7d6] px-3 py-2 font-semibold text-[#7f5f01]">
                        Not set up in Lead Table Configuration yet, so these
                        columns will not be saved: {shownPreview.ignoredColumns.join(", ")}.
                      </p>
                    ) : null}
                    {shownPreview.unmatchedAgents.length > 0 ? (
                      <div className="rounded border border-[#f5cd47] bg-[#fff7d6] px-3 py-2 text-[#7f5f01]">
                        <p className="font-semibold">
                          These Agent names do not match anyone in Account Management →
                          Agent membership, so {isPersonal ? "their Personal lead rows will be skipped" : "their rows stay unassigned"}:
                        </p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {shownPreview.unmatchedAgents.map((agent) => (
                            <li key={agent.name}>
                              <strong>{agent.name}</strong> — {unmatchedAgentText(agent)} (rows{" "}
                              {rowList(agent.rows)})
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {shownPreview.rowsWithoutPhone > 0 ? (
                      <p className="rounded border border-[#dfe1e6] bg-[#f7f8fa] px-3 py-2 font-medium text-[#42526e]">
                        {shownPreview.rowsWithoutPhone} row{shownPreview.rowsWithoutPhone === 1 ? " has" : "s have"} no
                        phone number and will be imported without one.
                      </p>
                    ) : null}
                    {shownPreview.optionsToCreate.length > 0 ? (
                      <p className="rounded border border-[#dfe1e6] bg-[#f7f8fa] px-3 py-2 font-medium text-[#42526e]">
                        New options will be added:{" "}
                        {shownPreview.optionsToCreate
                          .map((option) => `${option.column}: ${option.label}`)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {shownPreview.unknownHeaders.length > 0 ? (
                      <p className="font-medium text-[#6b778c]">
                        Ignored columns not in the template: {shownPreview.unknownHeaders.join(", ")}
                      </p>
                    ) : null}
                    <NoteList title="Will be skipped" tone="amber" notes={shownPreview.skipped} />
                    <NoteList title="Imported with a note" tone="gray" notes={shownPreview.warnings} />
                  </div>

                  <div className="mt-3 overflow-x-auto border border-[#dfe1e6]">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-[#f8fafc] text-[10px] font-bold uppercase tracking-[0.06em] text-[#667085]">
                        <tr>
                          <th className="px-3 py-2">Row</th>
                          <th className="px-3 py-2">Full Name</th>
                          <th className="px-3 py-2">Phone</th>
                          <th className="px-3 py-2">Insurance Needs</th>
                          <th className="px-3 py-2">Agent</th>
                          <th className="px-3 py-2">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#eef1f5]">
                        {shownPreview.previewRows.map((row) => {
                          const existing = existingRowSet.has(row.row);
                          const removed =
                            removedRows.has(row.row) ||
                            existingClients.some(
                              (match) => match.row === row.row && match.sameEventBlocked,
                            );
                          return (
                            <tr
                              key={row.row}
                              className={`${existing ? "bg-[#fff4f2]" : ""} ${removed ? "text-[#97a0af] line-through" : "text-[#172b4d]"}`}
                            >
                              <td className="px-3 py-2">{row.row}</td>
                              <td className="px-3 py-2 font-semibold">{row.name ?? "—"}</td>
                              <td className="px-3 py-2">{row.phone ?? "—"}</td>
                              <td className="px-3 py-2">{row.insuranceNeeds ?? "—"}</td>
                              <td className="px-3 py-2">
                                {row.agent.status === "matched" ? (
                                  row.agent.label
                                ) : row.agent.status === "none" ? (
                                  <span className="text-[#97a0af]">Unassigned</span>
                                ) : (
                                  <span className="font-semibold text-[#974f0c]">
                                    ⚠ {row.agent.label ?? "not found"}
                                  </span>
                                )}
                              </td>
                              <td className="max-w-[18rem] truncate px-3 py-2" title={row.description ?? undefined}>
                                {row.description ?? "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {shownPreview.totalRows > shownPreview.previewRows.length ? (
                    <p className="mt-1 text-xs text-[#6b778c]">
                      Showing the first {shownPreview.previewRows.length} of{" "}
                      {shownPreview.totalRows.toLocaleString()} rows.
                    </p>
                  ) : null}

                  {eventId && weightPreview?.enabled && weightPreview.eventId === eventId ? (
                    <label className="mt-3 flex items-start gap-2 rounded border border-[#dfe1e6] bg-white p-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={autoAssign}
                        onChange={(event) => setAutoAssign(event.target.checked)}
                      />
                      <span>
                        <span className="font-semibold text-[#172b4d]">
                          Distribute leads without an Agent by ratio
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
                            Nobody is set to receive this Event — these leads will stay in the pool.
                          </span>
                        )}
                      </span>
                    </label>
                  ) : null}
                </section>
              </>
            ) : null}

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
                    Assigned from file: <strong>{result.assignedFromFile}</strong>
                  </span>
                  <span>
                    Removed (existing clients): <strong>{result.excluded}</strong>
                  </span>
                  <span>
                    Duplicates in this event: <strong>{result.duplicates}</strong>
                  </span>
                  <span>
                    Skipped: <strong>{result.skipped.length}</strong>
                  </span>
                </div>
                {result.autoAssign ? (
                  <p className="mt-2 text-sm text-emerald-900">
                    Distributed: <strong>{result.autoAssign.assigned}</strong>
                    {result.autoAssign.unassigned > 0 ? (
                      <>
                        {" · left in the pool: "}
                        <strong>{result.autoAssign.unassigned}</strong>
                        {result.autoAssign.reason ? ` — ${result.autoAssign.reason}` : null}
                      </>
                    ) : null}
                  </p>
                ) : null}
                {result.createdOptions.length > 0 ? (
                  <p className="mt-2 text-xs font-semibold text-emerald-900">
                    Added options:{" "}
                    {result.createdOptions
                      .map((option) => `${option.column}: ${option.label}`)
                      .join(" · ")}
                  </p>
                ) : null}
                {result.ignoredColumns.length > 0 ? (
                  <p className="mt-2 text-xs font-semibold text-[#974f0c]">
                    Not saved (not in Lead Table Configuration): {result.ignoredColumns.join(", ")}
                  </p>
                ) : null}
                {result.unmatchedAgents.length > 0 ? (
                  <p className="mt-2 text-xs font-semibold text-[#974f0c]">
                    Left unassigned because the Agent cannot receive leads:{" "}
                    {result.unmatchedAgents
                      .map((agent) => `${agent.name} (${agent.rows.length})`)
                      .join(", ")}
                  </p>
                ) : null}
                <div className="mt-2 space-y-2 text-xs">
                  <NoteList title="Skipped" tone="amber" notes={result.skipped} />
                  <NoteList title="Imported with a note" tone="gray" notes={result.warnings} />
                </div>
              </section>
            )}
          </div>
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-[#dfe1e6] bg-white px-6 py-4">
          {missingForImport.length > 0 && !importing && !result ? (
            <span className="text-xs font-semibold text-[#974f0c]">
              Still need {missingForImport.join(", ")}.
            </span>
          ) : null}
          <button
            type="button"
            onClick={resetAndClose}
            disabled={importing}
            className="rounded px-4 py-2 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:opacity-50"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {result ? null : (
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void importFile()}
              disabled={!canImport}
            >
              <Upload className="h-4 w-4" />
              {importing
                ? "Importing..."
                : shownPreview
                  ? `Import ${importCount.toLocaleString()} lead${importCount === 1 ? "" : "s"}`
                  : "Import leads"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function NoteList({
  title,
  tone,
  notes,
}: {
  title: string;
  tone: "amber" | "gray";
  notes: readonly { row: number; reason: string }[];
}) {
  if (notes.length === 0) return null;
  return (
    <details
      className={`rounded border px-3 py-2 ${
        tone === "amber"
          ? "border-[#f5cd47] bg-[#fff7d6] text-[#7f5f01]"
          : "border-[#dfe1e6] bg-[#f7f8fa] text-[#42526e]"
      }`}
    >
      <summary className="cursor-pointer font-semibold">
        {title}: {notes.length} row{notes.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
        {notes.map((note, index) => (
          <li key={`${note.row}-${index}`}>
            Row {note.row}: {note.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

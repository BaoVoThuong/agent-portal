"use client";

import { useState } from "react";
import { X } from "lucide-react";
import * as XLSX from "xlsx";
import type { AgentLinks } from "@/lib/accounting/health/links";
import { rowsFromTable, type SheetRow } from "@/lib/accounting/health/sheet-rows";
import {
  formatMoney,
  monthKey,
  MONTHS,
  parseMoney,
  type HealthCommissionRow,
} from "@/lib/accounting/health/values";

export type ImportedMonth = {
  year: number;
  month: number;
  rows: Omit<HealthCommissionRow, "id" | "y" | "m">[];
};

type Parsed = {
  fileName: string;
  rows: SheetRow[];
  missing: string[];
  noHeader: boolean;
  fileMonths: number[];
};

function withoutMonth(row: SheetRow): ImportedMonth["rows"][number] {
  const copy: Partial<SheetRow> = { ...row };
  delete copy.month;
  return copy as ImportedMonth["rows"][number];
}

const LABEL_CLASS = "text-xs font-bold uppercase tracking-wide text-[#6b778c]";
const SELECT_CLASS =
  "h-9 rounded border-2 border-[#dfe1e6] bg-white px-2 text-sm font-semibold text-[#172b4d] focus:border-[#0c66e4] focus:outline-none";

/**
 * Pick a month file, see what is in it, import it into that month. A month that
 * already has rows is replaced as a whole, after an explicit tick.
 */
export function UploadMonthDialog({
  rows,
  links,
  onClose,
  onImport,
}: {
  rows: HealthCommissionRow[];
  links: AgentLinks;
  onClose: () => void;
  onImport: (month: ImportedMonth) => void;
}) {
  const latest = rows.reduce((max, row) => Math.max(max, monthKey(row.y, row.m)), 0);
  const next = latest % 100 === 12 ? monthKey(Math.floor(latest / 100) + 1, 1) : latest + 1;
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [target, setTarget] = useState(next);
  const [confirmed, setConfirmed] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readFile = async (file: File) => {
    setReading(true);
    setError(null);
    try {
      const book = XLSX.read(await file.arrayBuffer());
      const table = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], {
        header: 1,
        raw: false,
        defval: "",
      });
      const result = rowsFromTable(table);
      const fileMonths = [...new Set(result.rows.filter((row) => row.month).map((row) => monthKey(row.month![0], row.month![1])))].sort();
      setParsed({ fileName: file.name, ...result, fileMonths });
      if (fileMonths.length === 1) setTarget(fileMonths[0]);
      setConfirmed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read this file");
    } finally {
      setReading(false);
    }
  };

  const year = Math.floor(target / 100);
  const month = target % 100;
  const existing = rows.filter((row) => row.y === year && row.m === month).length;
  const agents = parsed ? [...new Set(parsed.rows.map((row) => row.agent))] : [];
  const unlinked = agents.filter((name) => !links[name]);
  const total = parsed ? parsed.rows.reduce((sum, row) => sum + (parseMoney(row.ar) ?? 0), 0) : 0;
  const years = [...new Set([...rows.map((row) => row.y), year, year + 1])].sort();
  const canImport = Boolean(parsed && parsed.rows.length > 0 && (!existing || confirmed));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Upload month"
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#172b4d]">Upload month</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <label className="block cursor-pointer rounded-lg border-2 border-dashed border-[#dfe1e6] bg-[#fafbfc] px-4 py-6 text-center text-sm font-semibold text-[#44546f] transition hover:border-[#85b8ff]">
            {reading ? "Reading…" : parsed ? parsed.fileName : <>Drop the month file here or <span className="text-[#0c66e4]">browse</span></>}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
          </label>

          {error ? <p className="rounded bg-[#ffeceb] px-3 py-2 text-sm font-semibold text-[#ae2e24]">{error}</p> : null}
          {parsed?.noHeader ? (
            <p className="rounded bg-[#ffeceb] px-3 py-2 text-sm font-semibold text-[#ae2e24]">
              No header row found — the file needs columns like agent, deal_name, carrier, primary_member_id, agent_received.
            </p>
          ) : null}

          {parsed && !parsed.noHeader ? (
            <>
              <div className="flex items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className={LABEL_CLASS}>Month</span>
                  <div className="flex gap-2">
                    <select
                      value={month}
                      onChange={(event) => {
                        setTarget(monthKey(year, Number(event.target.value)));
                        setConfirmed(false);
                      }}
                      className={SELECT_CLASS}
                    >
                      {MONTHS.map((label, index) => (
                        <option key={label} value={index + 1}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={year}
                      onChange={(event) => {
                        setTarget(monthKey(Number(event.target.value), month));
                        setConfirmed(false);
                      }}
                      className={SELECT_CLASS}
                    >
                      {years.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {parsed.fileMonths.length > 1 ? (
                <p className="rounded bg-[#fff7d6] px-3 py-2 text-sm font-semibold text-[#a54800]">
                  This file holds {parsed.fileMonths.length} months. Every row goes into the month chosen above.
                </p>
              ) : null}
              {parsed.missing.length ? (
                <p className="rounded bg-[#fff7d6] px-3 py-2 text-sm font-semibold text-[#a54800]">
                  Columns not found: {parsed.missing.join(", ")}
                </p>
              ) : null}

              <div className="grid grid-cols-4 gap-2">
                {[
                  ["Rows", parsed.rows.length.toLocaleString()],
                  ["Agents", String(agents.length)],
                  ["Not linked", String(unlinked.length)],
                  ["Agent Received", formatMoney(total)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border border-[#dfe1e6] px-3 py-2">
                    <div className={LABEL_CLASS}>{label}</div>
                    <div className="mt-0.5 text-base font-bold tabular-nums text-[#172b4d]">{value}</div>
                  </div>
                ))}
              </div>
              {unlinked.length ? (
                <p className="text-sm text-[#6b778c]">Not linked to a portal account: {unlinked.join(", ")}</p>
              ) : null}

              {existing ? (
                <label className="flex items-start gap-2 rounded bg-[#fff7d6] px-3 py-2 text-sm font-semibold text-[#a54800]">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#c1c7d0]"
                  />
                  {MONTHS[month - 1]} {year} already has {existing.toLocaleString()} rows. Replace all of them with this file.
                </label>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#dfe1e6] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded bg-[#f1f2f4] px-4 text-sm font-semibold text-[#44546f] transition hover:bg-[#e4e6ea]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canImport}
            onClick={() => onImport({ year, month, rows: parsed!.rows.map(withoutMonth) })}
            className="h-9 rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:bg-[#f1f2f4] disabled:text-[#a5adba]"
          >
            Import
          </button>
        </footer>
      </div>
    </div>
  );
}

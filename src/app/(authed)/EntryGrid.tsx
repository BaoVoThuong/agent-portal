"use client";

import * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type CellStyle,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
  type ValueFormatterParams,
} from "ag-grid-community";
import type { Entry, EntryInput } from "../../lib/config";

ModuleRegistry.registerModules([AllCommunityModule]);

type DraftRow = EntryInput & { _key: string };

const EMPTY_DRAFT: Omit<DraftRow, "_key"> = {
  carrier_name: "",
  state: "",
  zipcode: "",
  effective_date: "",
  customer_name: "",
  policy_id: "",
  number_of_members: null,
  fub_link: "",
};

const gridTheme = themeQuartz.withParams({
  accentColor: "#15345f",
  borderColor: "#d8dee7",
  browserColorScheme: "light",
  columnBorder: true,
  fontFamily: "Arial, Helvetica, sans-serif",
  foregroundColor: "#16233a",
  headerBackgroundColor: "#f7f9fc",
  headerFontWeight: 700,
  oddRowBackgroundColor: "#fbfcfe",
  rowBorder: true,
  wrapperBorderRadius: 0,
});

const rowNumberCellStyle: CellStyle = {
  color: "#667085",
  fontSize: "10px",
  textAlign: "center",
  padding: "0",
};

const actionCellStyle: CellStyle = { border: "none" };

function makeEmptyRows(count: number): DraftRow[] {
  return Array.from({ length: count }, () => ({
    ...EMPTY_DRAFT,
    _key: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11),
  }));
}

function normalizeLink(value: unknown) {
  const href = String(value ?? "").trim();
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  return `https://${href}`;
}

export default function EntryGrid({
  initialHistory,
}: {
  initialHistory: Entry[];
}) {
  const draftApiRef = useRef<GridApi<DraftRow> | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>(() => makeEmptyRows(10));
  const [history, setHistory] = useState<Entry[]>(initialHistory);
  const historyApiRef = useRef<GridApi<Entry> | null>(null);

  const onHistoryReady = (event: GridReadyEvent<Entry>) => {
    historyApiRef.current = event.api;
  };
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quickFilter, setQuickFilter] = useState("");
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [historyMessage, setHistoryMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
      if (lines.length <= 1) return;

      const parsedRows: DraftRow[] = lines.slice(1).map(line => {
        // Simple CSV parse handling potential commas in quotes
        const parts: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') inQuotes = !inQuotes;
          else if (char === "," && !inQuotes) {
            parts.push(current.trim());
            current = "";
          } else {
            current += char;
          }
        }
        parts.push(current.trim());

        if (parts.length < 6) return null;
        return {
          _key: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11),
          carrier_name: parts[0] || "",
          state: parts[1] || "",
          zipcode: parts[2] || "",
          effective_date: parts[3] || "",
          customer_name: parts[4] || "",
          policy_id: parts[5] || "",
          number_of_members: parts[6] ? Number(parts[6]) : null,
          fub_link: parts[7] || "",
        };
      }).filter((r): r is DraftRow => r !== null);

      if (parsedRows.length > 0) {
        setDrafts([...parsedRows, ...makeEmptyRows(5)]);
        setSubmitMessage({ kind: "ok", text: `Imported ${parsedRows.length} rows successfully.` });
      }
      
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const isRowFilled = useCallback((row: DraftRow) => {
    return (
      (row.carrier_name ?? "").trim() !== "" ||
      (row.state ?? "").trim() !== "" ||
      (row.zipcode ?? "").trim() !== "" ||
      (row.effective_date ?? "").trim() !== "" ||
      (row.customer_name ?? "").trim() !== "" ||
      (row.policy_id ?? "").trim() !== "" ||
      (row.fub_link ?? "").trim() !== "" ||
      row.number_of_members !== null
    );
  }, []);

  const isRowComplete = useCallback((row: DraftRow) => {
    return (
      (row.carrier_name ?? "").trim() !== "" &&
      (row.state ?? "").trim() !== "" &&
      (row.zipcode ?? "").trim() !== "" &&
      (row.effective_date ?? "").trim() !== "" &&
      (row.customer_name ?? "").trim() !== "" &&
      (row.policy_id ?? "").trim() !== ""
    );
  }, []);

  const filledCount = useMemo(
    () => drafts.filter(isRowFilled).length,
    [drafts, isRowFilled],
  );

  const draftCols: ColDef<DraftRow>[] = useMemo(
    () => [
      {
        headerName: "",
        valueGetter: "node.rowIndex + 1",
        width: 30,
        minWidth: 30,
        maxWidth: 30,
        pinned: "left",
        resizable: false,
        suppressMovable: true,
        filter: false,
        sortable: false,
        cellStyle: rowNumberCellStyle,
      },
      { field: "carrier_name", headerName: "Carrier", editable: true, flex: 0.72, minWidth: 103 },
      { field: "state", headerName: "State", editable: true, flex: 0.48, minWidth: 85 },
      { field: "zipcode", headerName: "Zipcode", editable: true, flex: 0.72, minWidth: 103 },
      {
        field: "effective_date",
        headerName: "Effective Date",
        editable: true,
        flex: 1.18,
        minWidth: 166,
        cellDataType: "dateString",
        cellEditor: "agDateStringCellEditor",
      },
      {
        field: "customer_name",
        headerName: "Customer Name",
        editable: true,
        flex: 1.34,
        minWidth: 157,
      },
      {
        field: "policy_id",
        headerName: "Policy ID",
        editable: true,
        flex: 1.2,
        minWidth: 157,
      },
      {
        field: "number_of_members",
        headerName: "Members",
        editable: true,
        flex: 0.72,
        minWidth: 130,
        valueParser: (params) => {
          const value = params.newValue;
          if (value === "" || value === null || value === undefined) {
            return null;
          }
          const number = Number(value);
          return Number.isFinite(number) ? number : null;
        },
      },
      {
        field: "fub_link",
        headerName: "FUB Link",
        editable: true,
        flex: 1.44,
        minWidth: 112,
      },
    ],
    [],
  );

  const historyCols: ColDef<Entry>[] = useMemo(
    () => [
      {
        headerName: "",
        valueGetter: "node.rowIndex + 1",
        width: 30,
        minWidth: 30,
        maxWidth: 30,
        pinned: "left",
        resizable: false,
        suppressMovable: true,
        filter: false,
        sortable: false,
        cellStyle: rowNumberCellStyle,
      },
      {
        field: "created_at",
        headerName: "Date Submitted",
        flex: 1.2,
        minWidth: 121,
        valueFormatter: (params: ValueFormatterParams<Entry, string>) =>
          params.value
            ? new Date(params.value).toLocaleDateString("en-US", {
                month: "2-digit",
                day: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "",
      },
      {
        field: "carrier_name",
        headerName: "Carrier",
        editable: false,
        flex: 1,
        minWidth: 120,
      },
      {
        field: "state",
        headerName: "State",
        editable: false,
        flex: 0.8,
        minWidth: 110,
      },
      {
        field: "zipcode",
        headerName: "Zipcode",
        editable: false,
        flex: 0.9,
        minWidth: 120,
      },
      {
        field: "effective_date",
        headerName: "Effective Date",
        editable: false,
        flex: 1.3,
        minWidth: 160,
      },
      {
        field: "customer_name",
        headerName: "Policy Holder",
        editable: false,
        flex: 1.44,
        minWidth: 160,
      },
      {
        field: "policy_id",
        headerName: "Policy ID",
        editable: false,
        flex: 1.2,
        minWidth: 157,
      },
      {
        field: "number_of_members",
        headerName: "Members",
        editable: false,
        flex: 0.72,
        minWidth: 130,
      },
      {
        field: "fub_link",
        headerName: "FUB Link",
        editable: false,
        flex: 1.44,
        minWidth: 112,
        cellRenderer: (params: ICellRendererParams<Entry, string>) => {
          const href = normalizeLink(params.value);
          if (!href) return "";
          return (
            <div className="flex h-full w-full items-center">
              <a
                className="font-medium text-[#15345f] underline underline-offset-2"
                href={href}
                rel="noreferrer"
                target="_blank"
              >
                Open FUB
              </a>
            </div>
          );
        },
      },
      {
        headerName: "",
        minWidth: 80,
        flex: 0.6,
        sortable: false,
        filter: false,
        resizable: false,
        cellStyle: actionCellStyle,
        cellRenderer: (params: ICellRendererParams<Entry>) => {
          const entry = params.data;
          if (!entry) return null;
          return (
            <div className="flex h-full w-full items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => params.context.setEditingEntry(entry)}
                className="text-blue-600 hover:text-blue-800 transition-colors"
                title="Edit entry"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256">
                  <path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"></path>
                </svg>
              </button>
              <button
                type="button"
                onClick={() => params.context.handleDelete(entry.id)}
                className="text-red-500 hover:text-red-700 transition-colors"
                title="Delete entry"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256">
                  <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path>
                </svg>
              </button>
            </div>
          );
        },
      },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      filter: true,
      minWidth: 70,
      resizable: true,
      sortable: true,
      wrapHeaderText: true,
      autoHeaderHeight: true,
    }),
    [],
  );

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/entries", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setHistory(json.entries ?? []);
    } catch (error) {
      setHistoryMessage({ kind: "err", text: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this entry?")) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to delete");
      }
      await loadHistory();
      setHistoryMessage({ kind: "ok", text: "Entry deleted successfully." });
    } catch (err) {
      setHistoryMessage({ kind: "err", text: (err as Error).message });
      setLoading(false);
    }
  }, [loadHistory]);

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingEntry) return;

    setIsUpdating(true);
    try {
      const res = await fetch(`/api/entries/${editingEntry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingEntry),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to update");
      }
      setHistoryMessage({ kind: "ok", text: "Entry updated successfully." });
      setEditingEntry(null);
      await loadHistory();
    } catch (err) {
      setHistoryMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setIsUpdating(false);
    }
  };

  const gridContext = useMemo(
    () => ({ handleDelete, setEditingEntry }),
    [handleDelete, setEditingEntry],
  );

  const onHistoryCellValueChanged = useCallback(async (event: CellValueChangedEvent<Entry>) => {
    try {
      const res = await fetch(`/api/entries/${event.data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event.data),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to update");
      }
      setHistoryMessage({ kind: "ok", text: "Entry updated successfully." });
    } catch (err) {
      setHistoryMessage({ kind: "err", text: (err as Error).message });
      loadHistory();
    }
  }, [loadHistory]);

  const onDraftReady = (event: GridReadyEvent<DraftRow>) => {
    draftApiRef.current = event.api;
  };

  const clearDrafts = () => {
    setDrafts(makeEmptyRows(10));
    setSubmitMessage(null);
  };

  const handleSubmit = async () => {
    setSubmitMessage(null);
    draftApiRef.current?.stopEditing();

    const filled = drafts.filter(isRowFilled);
    if (filled.length === 0) {
      setSubmitMessage({ kind: "err", text: "No rows to submit." });
      return;
    }

    const incompleteIndices = drafts
      .map((row, idx) => (isRowFilled(row) && !isRowComplete(row) ? idx + 1 : null))
      .filter((idx): idx is number => idx !== null);

    if (incompleteIndices.length > 0) {
      setSubmitMessage({
        kind: "err",
        text: `Row(s) ${incompleteIndices.join(", ")} are missing required fields (Carrier, State, Zipcode, Date, Name, or Policy).`,
      });
      return;
    }

    setSubmitting(true);
    try {
      const payload = filled.map((draft) => ({
        carrier_name: draft.carrier_name,
        state: draft.state,
        zipcode: draft.zipcode,
        effective_date: draft.effective_date,
        customer_name: draft.customer_name,
        policy_id: draft.policy_id,
        number_of_members: draft.number_of_members,
        fub_link: draft.fub_link,
      }));
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to submit");

      setDrafts(makeEmptyRows(10));
      await loadHistory();
      setSubmitMessage({
        kind: "ok",
        text: json.warning
          ? `Submitted successfully. ${json.warning}`
          : "Submitted successfully.",
      });
    } catch (error) {
      setSubmitMessage({ kind: "err", text: (error as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[#d8dee7] bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-[#d8dee7] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#16233a]">
              Batch Enrollment Entry
            </h2>
            <p className="mt-1 text-sm text-[#667085]">
              Input enrollment data manually or via bulk CSV upload.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportCsv}
              accept=".csv"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded border border-[#c9d2df] px-3 py-1.5 text-sm font-medium text-[#15345f] transition-colors hover:bg-[#f2f6fb]"
              type="button"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 256 256">
                <path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM152,44l44,44H152ZM200,216H56V40h80V96a8,8,0,0,0,8,8h56Zm-42.34-45.66a8,8,0,0,1-11.32,11.32L136,171.31V200a8,8,0,0,1-16,0V171.31l-10.34,10.35a8,8,0,0,1-11.32-11.32l24-24a8,8,0,0,1,11.32,0Z"></path>
              </svg>
              Import CSV
            </button>
            <button
              onClick={clearDrafts}
              className="rounded border border-[#c9d2df] px-3 py-1.5 text-sm font-medium text-[#475467] transition-colors hover:bg-[#f2f6fb]"
              type="button"
            >
              Clear Form
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || filledCount === 0}
              className="rounded border border-transparent bg-[#15345f] px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#102b52] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </div>
        </div>

        {submitMessage && (
          <div
            className={`mx-5 mt-4 rounded border px-3 py-2 text-sm ${submitMessage.kind === "ok"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
              }`}
          >
            {submitMessage.text}
          </div>
        )}

        <div className="px-5 pb-5 pt-4">
          <div className="h-[430px] w-full">
            <AgGridReact<DraftRow>
              theme={gridTheme}
              rowData={drafts}
              columnDefs={draftCols}
              defaultColDef={defaultColDef}
              onGridReady={onDraftReady}
              singleClickEdit
              stopEditingWhenCellsLoseFocus
              getRowId={(params) => params.data._key}
              onCellValueChanged={(event) => {
                setDrafts((rows) =>
                  rows.map((row) =>
                    row._key === event.data._key ? { ...event.data } : row,
                  ),
                );
              }}
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#d8dee7] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#d8dee7] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#16233a]">
              Submission History
            </h2>
            <p className="mt-1 text-sm text-[#667085]">
              Review and manage previously submitted enrollment records.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search policy, name..."
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value)}
              className="w-48 rounded border border-[#c9d2df] px-3 py-1.5 text-sm text-[#16233a] placeholder-[#667085] focus:border-[#15345f] focus:outline-none focus:ring-1 focus:ring-[#15345f]"
            />
            <button
              onClick={() => historyApiRef.current?.exportDataAsCsv({
                fileName: `agent_portal_history_${new Date().toISOString().split('T')[0]}.csv`,
                columnKeys: historyCols.filter(c => c.field).map(c => c.field as string)
              })}
              className="flex items-center gap-2 rounded border border-[#c9d2df] px-3 py-1.5 text-sm font-medium text-[#15345f] transition-colors hover:bg-[#f2f6fb]"
              type="button"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 256 256">
                <path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V40a8,8,0,0,0-16,0v84.69L93.66,98.34A8,8,0,0,0,82.34,109.66Z"></path>
              </svg>
              Export Excel
            </button>
          </div>
        </div>

        {historyMessage && (
          <div
            className={`mx-5 mt-4 rounded border px-3 py-2 text-sm ${historyMessage.kind === "ok"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
              }`}
          >
            {historyMessage.text}
          </div>
        )}

        <div className="px-5 pb-5 pt-4">
          <div className="h-[380px] w-full">
            <AgGridReact<Entry>
              theme={gridTheme}
              rowData={history}
              columnDefs={historyCols}
              defaultColDef={defaultColDef}
              quickFilterText={quickFilter}
              loading={loading}
              getRowId={(params) => params.data.id}
              context={gridContext}
              onGridReady={onHistoryReady}
              onCellValueChanged={onHistoryCellValueChanged}
              singleClickEdit
              stopEditingWhenCellsLoseFocus
            />
          </div>
        </div>
      </section>
      {/* Edit Modal */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-xl font-bold text-[#15345f]">Edit Registration</h3>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Carrier</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.carrier_name}
                    onChange={(e) => setEditingEntry({ ...editingEntry, carrier_name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">State</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.state}
                    onChange={(e) => setEditingEntry({ ...editingEntry, state: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Zipcode</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.zipcode}
                    onChange={(e) => setEditingEntry({ ...editingEntry, zipcode: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Effective Date</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    type="date"
                    value={editingEntry.effective_date}
                    onChange={(e) => setEditingEntry({ ...editingEntry, effective_date: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase">Customer Name</label>
                <input
                  className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                  value={editingEntry.customer_name}
                  onChange={(e) => setEditingEntry({ ...editingEntry, customer_name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase">Policy Number</label>
                <input
                  className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                  value={editingEntry.policy_id}
                  onChange={(e) => setEditingEntry({ ...editingEntry, policy_id: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase"># Members</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    type="number"
                    value={editingEntry.number_of_members ?? ""}
                    onChange={(e) => setEditingEntry({ ...editingEntry, number_of_members: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">FUB Link</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.fub_link ?? ""}
                    onChange={(e) => setEditingEntry({ ...editingEntry, fub_link: e.target.value })}
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="rounded bg-[#15345f] px-6 py-2 text-sm font-bold text-white shadow-lg hover:bg-[#102b52] disabled:opacity-50"
                >
                  {isUpdating ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

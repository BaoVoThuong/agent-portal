"use client";

import * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellValueChangedEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
  type ValueFormatterParams,
} from "ag-grid-community";
import type { PcEntry, PcEntryInput } from "@/lib/domain/pc-entry.types";
import {
  actionCellStyle,
  gridTheme,
  makeDraftKey,
  parseCsvLine,
  rowNumberCellStyle,
} from "../_shared/grid";

ModuleRegistry.registerModules([AllCommunityModule]);

// selected_agent is chosen once per batch (above the grid), not per row.
type DraftRow = Omit<PcEntryInput, "selected_agent"> & { _key: string };

const EMPTY_DRAFT: Omit<DraftRow, "_key"> = {
  agency: "",
  insured_name: "",
  address: "",
  type: "",
  company: "",
  policy_number: "",
  pay_plan: "",
  premium: "",
  effective_date: "",
  expired_date: "",
};

function makeEmptyRows(count: number): DraftRow[] {
  return Array.from({ length: count }, () => ({
    ...EMPTY_DRAFT,
    _key: makeDraftKey(),
  }));
}

export default function PcEntryGrid({
  agentOptions,
  initialHistory,
}: {
  agentOptions: string[];
  initialHistory: PcEntry[];
}) {
  const draftApiRef = useRef<GridApi<DraftRow> | null>(null);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [drafts, setDrafts] = useState<DraftRow[]>(() => makeEmptyRows(10));
  const [history, setHistory] = useState<PcEntry[]>(initialHistory);
  const historyApiRef = useRef<GridApi<PcEntry> | null>(null);

  const onHistoryReady = (event: GridReadyEvent<PcEntry>) => {
    historyApiRef.current = event.api;
  };
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quickFilter, setQuickFilter] = useState("");
  const [editingEntry, setEditingEntry] = useState<PcEntry | null>(null);
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
        const parts = parseCsvLine(line);

        if (parts.length < 10) return null;
        return {
          _key: makeDraftKey(),
          agency: parts[0] || "",
          insured_name: parts[1] || "",
          address: parts[2] || "",
          type: parts[3] || "",
          company: parts[4] || "",
          policy_number: parts[5] || "",
          pay_plan: parts[6] || "",
          premium: parts[7] || "",
          effective_date: parts[8] || "",
          expired_date: parts[9] || "",
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
      (row.agency ?? "").trim() !== "" ||
      (row.insured_name ?? "").trim() !== "" ||
      (row.address ?? "").trim() !== "" ||
      (row.type ?? "").trim() !== "" ||
      (row.company ?? "").trim() !== "" ||
      (row.policy_number ?? "").trim() !== "" ||
      (row.pay_plan ?? "").trim() !== "" ||
      (row.premium ?? "").trim() !== "" ||
      (row.effective_date ?? "").trim() !== "" ||
      (row.expired_date ?? "").trim() !== ""
    );
  }, []);

  const isRowComplete = useCallback((row: DraftRow) => {
    return (
      (row.agency ?? "").trim() !== "" &&
      (row.insured_name ?? "").trim() !== "" &&
      (row.address ?? "").trim() !== "" &&
      (row.type ?? "").trim() !== "" &&
      (row.company ?? "").trim() !== "" &&
      (row.policy_number ?? "").trim() !== "" &&
      (row.pay_plan ?? "").trim() !== "" &&
      (row.premium ?? "").trim() !== "" &&
      (row.effective_date ?? "").trim() !== "" &&
      (row.expired_date ?? "").trim() !== ""
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
      { field: "agency", headerName: "Agency", editable: true, flex: 0.8, minWidth: 110 },
      {
        field: "insured_name",
        headerName: "Insured Name",
        editable: true,
        flex: 1.35,
        minWidth: 170,
      },
      {
        field: "address",
        headerName: "Address",
        editable: true,
        flex: 1.5,
        minWidth: 190,
      },
      { field: "type", headerName: "Type", editable: true, flex: 0.8, minWidth: 110 },
      { field: "company", headerName: "Company", editable: true, flex: 1, minWidth: 140 },
      {
        field: "policy_number",
        headerName: "Policy #",
        editable: true,
        flex: 1.1,
        minWidth: 150,
      },
      {
        field: "pay_plan",
        headerName: "Pay Plan",
        editable: true,
        flex: 0.9,
        minWidth: 130,
      },
      {
        field: "premium",
        headerName: "Premium",
        editable: true,
        flex: 0.9,
        minWidth: 130,
      },
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
        field: "expired_date",
        headerName: "Expired Date",
        editable: true,
        flex: 1.18,
        minWidth: 166,
        cellDataType: "dateString",
        cellEditor: "agDateStringCellEditor",
      },
    ],
    [],
  );

  const historyCols: ColDef<PcEntry>[] = useMemo(
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
        valueFormatter: (params: ValueFormatterParams<PcEntry, string>) =>
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
        field: "selected_agent",
        headerName: "Agent",
        editable: false,
        flex: 1,
        minWidth: 120,
      },
      {
        field: "agency",
        headerName: "Agency",
        editable: false,
        flex: 0.85,
        minWidth: 120,
      },
      {
        field: "insured_name",
        headerName: "Insured Name",
        editable: false,
        flex: 1.35,
        minWidth: 170,
      },
      {
        field: "address",
        headerName: "Address",
        editable: false,
        flex: 1.5,
        minWidth: 190,
      },
      {
        field: "type",
        headerName: "Type",
        editable: false,
        flex: 0.85,
        minWidth: 110,
      },
      {
        field: "company",
        headerName: "Company",
        editable: false,
        flex: 1,
        minWidth: 140,
      },
      {
        field: "policy_number",
        headerName: "Policy #",
        editable: false,
        flex: 1.1,
        minWidth: 150,
      },
      {
        field: "pay_plan",
        headerName: "Pay Plan",
        editable: false,
        flex: 0.9,
        minWidth: 130,
      },
      {
        field: "premium",
        headerName: "Premium",
        editable: false,
        flex: 0.9,
        minWidth: 130,
      },
      {
        field: "effective_date",
        headerName: "Effective Date",
        editable: false,
        flex: 1.2,
        minWidth: 160,
      },
      {
        field: "expired_date",
        headerName: "Expired Date",
        editable: false,
        flex: 1.2,
        minWidth: 160,
      },
      {
        headerName: "",
        minWidth: 80,
        flex: 0.6,
        sortable: false,
        filter: false,
        resizable: false,
        cellStyle: actionCellStyle,
        cellRenderer: (params: ICellRendererParams<PcEntry>) => {
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
      const res = await fetch("/api/pc-entries", { cache: "no-store" });
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
      const res = await fetch(`/api/pc-entries/${id}`, { method: "DELETE" });
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
      const res = await fetch(`/api/pc-entries/${editingEntry.id}`, {
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

  const onHistoryCellValueChanged = useCallback(async (event: CellValueChangedEvent<PcEntry>) => {
    try {
      const res = await fetch(`/api/pc-entries/${event.data.id}`, {
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

    if (selectedAgent.trim() === "") {
      setSubmitMessage({ kind: "err", text: "Please select an agent before submitting." });
      return;
    }

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
        text: `Row(s) ${incompleteIndices.join(", ")} are missing required P&C fields.`,
      });
      return;
    }

    setSubmitting(true);
    try {
      const payload = filled.map((draft) => ({
        selected_agent: selectedAgent.trim(),
        agency: draft.agency,
        insured_name: draft.insured_name,
        address: draft.address,
        type: draft.type,
        company: draft.company,
        policy_number: draft.policy_number,
        pay_plan: draft.pay_plan,
        premium: draft.premium,
        effective_date: draft.effective_date,
        expired_date: draft.expired_date,
      }));
      const res = await fetch("/api/pc-entries", {
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
              Batch P&amp;C Entry
            </h2>
            <p className="mt-1 text-sm text-[#667085]">
              Input P&amp;C registration data manually or via bulk CSV upload.
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
              disabled={submitting || filledCount === 0 || selectedAgent.trim() === ""}
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
          <div className="mb-4 flex flex-col gap-1.5 sm:max-w-sm">
            <label
              className="text-xs font-semibold uppercase tracking-wide text-[#667085]"
              htmlFor="batch-agent"
            >
              Agent <span className="text-rose-500">*</span>
            </label>
            <input
              id="batch-agent"
              list="batch-agent-options"
              value={selectedAgent}
              onChange={(event) => setSelectedAgent(event.target.value)}
              placeholder="Type to search agents..."
              autoComplete="off"
              className="rounded border border-[#c9d2df] px-3 py-1.5 text-sm text-[#16233a] placeholder-[#667085] focus:border-[#15345f] focus:outline-none focus:ring-1 focus:ring-[#15345f]"
            />
            <datalist id="batch-agent-options">
              {agentOptions.map((agent) => (
                <option key={agent} value={agent} />
              ))}
            </datalist>
          </div>
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
              Review and manage previously submitted P&amp;C records.
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
                fileName: `agent_portal_pc_history_${new Date().toISOString().split('T')[0]}.csv`,
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
            <AgGridReact<PcEntry>
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
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-xl font-bold text-[#15345f]">Edit Registration</h3>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Agency</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.agency}
                    onChange={(e) => setEditingEntry({ ...editingEntry, agency: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Insured Name</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.insured_name}
                    onChange={(e) => setEditingEntry({ ...editingEntry, insured_name: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase">Address</label>
                <input
                  className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                  value={editingEntry.address}
                  onChange={(e) => setEditingEntry({ ...editingEntry, address: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Type</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.type}
                    onChange={(e) => setEditingEntry({ ...editingEntry, type: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Company</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.company}
                    onChange={(e) => setEditingEntry({ ...editingEntry, company: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Policy #</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.policy_number}
                    onChange={(e) => setEditingEntry({ ...editingEntry, policy_number: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Pay Plan</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.pay_plan}
                    onChange={(e) => setEditingEntry({ ...editingEntry, pay_plan: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Premium</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={editingEntry.premium}
                    onChange={(e) => setEditingEntry({ ...editingEntry, premium: e.target.value })}
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
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Expired Date</label>
                  <input
                    className="w-full rounded border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    type="date"
                    value={editingEntry.expired_date}
                    onChange={(e) => setEditingEntry({ ...editingEntry, expired_date: e.target.value })}
                    required
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

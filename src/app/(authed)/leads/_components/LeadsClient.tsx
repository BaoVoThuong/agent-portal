"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, RefreshCw, Upload } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { resolveLeadAlerts, ALERT_SEVERITY, type LeadAlert } from "@/lib/leads/alerts";
import { isOwnLeadMutation, LEADS_TOPIC } from "@/lib/leads/realtime-topics";
import type { LeadAlertSettings, LeadInteractionType, LeadRow, LeadStatus } from "@/lib/leads/types";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { LeadDetailDrawer } from "./LeadDetailDrawer";
import { LeadImportDialog } from "./LeadImportDialog";

type LeadsClientProps = {
  product: "pc" | "health";
  currentEmail: string;
  isManager: boolean;
  initialLeads: LeadRow[];
  initialTotal: number;
  initialLimit: number;
  initialOffset: number;
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
  statuses: LeadStatus[];
  interactionTypes: LeadInteractionType[];
  alertSettings: LeadAlertSettings;
};

function sourceNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `lead-tab-${Math.random().toString(36).slice(2)}`;
}

function displayDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function displayValue(
  lead: LeadRow,
  column: TableColumn,
  statuses: Map<string, LeadStatus>,
  options: Map<string, TableColumnOption[]>
): string {
  switch (column.key) {
    case "key": return `#${lead.display_number}`;
    case "name": return lead.full_name ?? "—";
    case "phone": return lead.phone ?? "—";
    case "email": return lead.email ?? "—";
    case "assignee": return lead.assigned_to_email ?? "Unassigned";
    case "status": return lead.status_id ? statuses.get(lead.status_id)?.label ?? "Unknown status" : "—";
    case "attempts": return String(lead.contact_attempt_count);
    case "lastContact": return displayDate(lead.last_contacted_at);
    case "followUp": return displayDate(lead.next_follow_up_at);
    case "event": return lead.event_id ?? "—";
    case "createdAt": return displayDate(lead.created_at);
    default: {
      const value = lead.custom_values?.[column.key];
      if (value === null || value === undefined || value === "") return "—";
      const option = options.get(column.id)?.find((candidate) => candidate.label === String(value));
      return option?.label ?? String(value);
    }
  }
}

function alertTitle(alerts: LeadAlert[]): string {
  const labels: Record<LeadAlert, string> = {
    never_contacted: "No one has contacted this lead",
    stale: "Contact has gone stale",
    follow_up_overdue: "Follow-up is overdue",
    exhausted: "Maximum contact attempts reached",
  };
  return alerts.map((alert) => labels[alert]).join("; ");
}

export function LeadsClient({
  product,
  currentEmail,
  isManager,
  initialLeads,
  initialTotal,
  initialLimit,
  initialOffset,
  columns,
  columnOptions,
  statuses,
  interactionTypes,
  alertSettings,
}: LeadsClientProps) {
  const [leads, setLeads] = useState(initialLeads);
  const [total, setTotal] = useState(initialTotal);
  const [limit, setLimit] = useState(initialLimit);
  const [offset, setOffset] = useState(initialOffset);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<LeadRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assignmentEmail, setAssignmentEmail] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const sourceId = useState(sourceNonce)[0];
  const requestInFlight = useRef(false);
  const pendingRefresh = useRef(false);
  const sourceIdRef = useRef(sourceId);
  const statusById = useMemo(() => new Map(statuses.map((status) => [status.id, status])), [statuses]);
  const optionsByColumn = useMemo(() => {
    const result = new Map<string, TableColumnOption[]>();
    for (const option of columnOptions) result.set(option.column_id, [...(result.get(option.column_id) ?? []), option]);
    return result;
  }, [columnOptions]);

  const reload = async (nextOffset = offset) => {
    if (requestInFlight.current) {
      pendingRefresh.current = true;
      return;
    }
    requestInFlight.current = true;
    setRefreshing(true);
    try {
      const params = new URLSearchParams({ product, limit: String(limit), offset: String(nextOffset) });
      const response = await fetch(`/api/leads?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not refresh leads.");
      if (Array.isArray(payload?.leads)) setLeads(payload.leads as LeadRow[]);
      if (typeof payload?.total === "number") setTotal(payload.total);
      if (typeof payload?.limit === "number") setLimit(payload.limit);
      if (typeof payload?.offset === "number") setOffset(payload.offset);
      setSelected(new Set());
    } catch (error) {
      console.error("Could not refresh leads", error);
    } finally {
      requestInFlight.current = false;
      setRefreshing(false);
      if (pendingRefresh.current) {
        pendingRefresh.current = false;
        if (typeof document !== "undefined" && document.visibilityState === "visible") void reloadRef.current(nextOffset);
      }
    }
  };
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const channel = supabase
      .channel(LEADS_TOPIC)
      .on("broadcast", { event: "changed" }, (message) => {
        const messageSourceId = (message as { payload?: { sourceId?: unknown } }).payload?.sourceId;
        if (!isOwnLeadMutation(sourceIdRef.current, messageSourceId)) void reloadRef.current();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reloadRef.current();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function updateLead(nextLead: LeadRow) {
    setLeads((current) => current.map((lead) => lead.id === nextLead.id ? nextLead : lead));
    setSelectedLead((current) => current?.id === nextLead.id ? nextLead : current);
  }

  function toggleLead(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function assignSelected(toEmail: string | null) {
    if (selected.size === 0 || assigning) return;
    setAssigning(true);
    setAssignmentError(null);
    try {
      const response = await fetch("/api/leads/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-lead-client-source": sourceId },
        body: JSON.stringify({
          lead_ids: [...selected],
          to_email: toEmail,
          reason: assignmentReason,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not assign leads.");
      setAssignmentEmail("");
      setAssignmentReason("");
      setSelected(new Set());
      await reload();
    } catch (assignError) {
      setAssignmentError(assignError instanceof Error ? assignError.message : "Could not assign leads.");
    } finally {
      setAssigning(false);
    }
  }

  const allVisibleSelected = leads.length > 0 && leads.every((lead) => selected.has(lead.id));
  const pageEnd = Math.min(offset + limit, total);

  return (
    <main className="min-h-full bg-[#f7f8fa] px-6 py-6 text-[#172b4d]">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#6b778c]">Lead management</p>
            <h1 className="mt-1 text-3xl font-bold">{product === "pc" ? "P&C Leads" : "Health Leads"}</h1>
            <p className="mt-1 text-sm text-[#6b778c]">{total.toLocaleString()} active leads</p>
          </div>
          <div className="flex gap-2">
            {isManager && <button className="inline-flex items-center gap-2 rounded-md bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0958c7]" type="button" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import</button>}
            <button className="inline-flex items-center gap-2 rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm font-semibold text-[#172b4d] hover:bg-[#f1f3f5] disabled:opacity-50" type="button" onClick={() => void reload()} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </header>

        {isManager && selected.size > 0 && (
          <div className="mb-3 rounded-lg border border-[#b8d4ff] bg-[#eaf2ff] px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-[#172b4d]">{selected.size} lead{selected.size === 1 ? "" : "s"} selected</span>
              <input className="min-w-[220px] flex-1 rounded-md border border-[#b8c4d4] bg-white px-3 py-2 text-sm" placeholder="Agent email to assign" value={assignmentEmail} onChange={(event) => setAssignmentEmail(event.target.value)} disabled={assigning} />
              <input className="min-w-[180px] flex-1 rounded-md border border-[#b8c4d4] bg-white px-3 py-2 text-sm" placeholder="Reason (optional)" value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} disabled={assigning} />
              <button className="rounded-md bg-[#0c66e4] px-3 py-2 font-semibold text-white disabled:opacity-50" type="button" disabled={!assignmentEmail.trim() || assigning} onClick={() => void assignSelected(assignmentEmail.trim())}>{assigning ? "Saving..." : "Assign"}</button>
              <button className="rounded-md border border-[#b8c4d4] bg-white px-3 py-2 font-semibold text-[#172b4d] disabled:opacity-50" type="button" disabled={assigning} onClick={() => void assignSelected(null)}>Unassign</button>
            </div>
            {assignmentError && <p className="mt-2 text-xs font-semibold text-red-700">{assignmentError}</p>}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full border-collapse text-left text-sm">
              <thead className="bg-[#f7f8fa] text-xs uppercase tracking-[0.06em] text-[#6b778c]">
                <tr>
                  {isManager && <th className="w-12 px-4 py-3"><input type="checkbox" aria-label="Select visible leads" checked={allVisibleSelected} onChange={(event) => setSelected(event.target.checked ? new Set(leads.map((lead) => lead.id)) : new Set())} /></th>}
                  <th className="w-10 px-2 py-3" aria-label="Alerts" />
                  {columns.filter((column) => !column.hidden_default).map((column) => <th key={column.id} className="whitespace-nowrap px-4 py-3 font-bold">{column.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e6eaf0]">
                {leads.length === 0 && <tr><td colSpan={columns.length + (isManager ? 2 : 1)} className="px-4 py-12 text-center text-sm text-[#6b778c]">No leads found.</td></tr>}
                {leads.map((lead) => {
                  const alerts = resolveLeadAlerts(lead, lead.status_id ? statusById.get(lead.status_id) ?? null : null, alertSettings);
                  return (
                    <tr key={lead.id} className="cursor-pointer bg-white hover:bg-[#f7faff]" onClick={() => setSelectedLead(lead)}>
                      {isManager && <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select lead ${lead.display_number}`} checked={selected.has(lead.id)} onChange={() => toggleLead(lead.id)} /></td>}
                      <td className="px-2 py-3">{alerts.length > 0 && <span className={`inline-flex h-2.5 w-2.5 rounded-full ${alerts.some((alert) => ALERT_SEVERITY[alert] === "red") ? "bg-red-500" : "bg-amber-400"}`} title={alertTitle(alerts)} aria-label={alertTitle(alerts)}><CircleAlert className="sr-only" /></span>}</td>
                      {columns.filter((column) => !column.hidden_default).map((column) => <td key={column.id} className="max-w-[240px] truncate px-4 py-3 font-medium text-[#172b4d]">{displayValue(lead, column, statusById, optionsByColumn)}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6eaf0] px-4 py-3 text-sm text-[#6b778c]">
            <span>{total === 0 ? "0" : `${offset + 1}–${pageEnd}`} of {total.toLocaleString()}</span>
            <div className="flex items-center gap-2">
              <button className="inline-flex items-center gap-1 rounded-md border border-[#cfd8e5] bg-white px-3 py-1.5 font-semibold text-[#172b4d] disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={offset === 0 || refreshing} onClick={() => void reload(Math.max(0, offset - limit))}><ChevronLeft className="h-4 w-4" /> Previous</button>
              <button className="inline-flex items-center gap-1 rounded-md border border-[#cfd8e5] bg-white px-3 py-1.5 font-semibold text-[#172b4d] disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={pageEnd >= total || refreshing} onClick={() => void reload(offset + limit)}>Next <ChevronRight className="h-4 w-4" /></button>
            </div>
          </footer>
        </div>
      </div>
      <LeadDetailDrawer
        lead={selectedLead}
        currentEmail={currentEmail}
        sourceId={sourceId}
        statuses={statuses}
        interactionTypes={interactionTypes}
        onClose={() => setSelectedLead(null)}
        onLeadUpdated={updateLead}
      />
      <LeadImportDialog
        open={importOpen}
        product={product}
        sourceId={sourceId}
        onClose={() => setImportOpen(false)}
        onImported={() => reload()}
      />
    </main>
  );
}

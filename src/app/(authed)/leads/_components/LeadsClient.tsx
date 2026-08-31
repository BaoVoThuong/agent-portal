"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleAlert, Plus, Upload } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { resolveLeadAlerts, ALERT_SEVERITY, type LeadAlert } from "@/lib/leads/alerts";
import { isOwnLeadMutation, LEADS_TOPIC } from "@/lib/leads/realtime-topics";
import { personLabel } from "@/lib/tasks/people";
import { TaskSelect } from "../../tasks/_components/TaskSelect";
import type { LeadAlertSettings, LeadInteractionType, LeadRow, LeadStatus } from "@/lib/leads/types";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { LeadDetailDrawer } from "./LeadDetailDrawer";
import { LeadAddDialog } from "./LeadAddDialog";
import { LeadImportDialog } from "./LeadImportDialog";
import { LeadOverview } from "./LeadOverview";

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
  /** Empty for non-managers: only they can reassign, so only they get the roster. */
  assignees: { email: string; name: string | null }[];
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
  options: Map<string, TableColumnOption[]>,
  nameByEmail: Map<string, string>
): string {
  switch (column.key) {
    case "key": return `#${lead.display_number}`;
    case "name": return lead.full_name ?? "—";
    case "phone": return lead.phone ?? "—";
    case "email": return lead.email ?? "—";
    // Show who it is, not their login. personLabel falls back to a readable
    // form of the address when the roster has no name for them.
    case "assignee":
      return lead.assigned_to_email
        ? personLabel(lead.assigned_to_email, nameByEmail)
        : "Unassigned";
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
  assignees,
}: LeadsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState(initialLeads);
  const [total, setTotal] = useState(initialTotal);
  const [limit, setLimit] = useState(initialLimit);
  const [offset, setOffset] = useState(initialOffset);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<LeadRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assignmentEmail, setAssignmentEmail] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "overview">(
    () => searchParams.get("view") === "overview" ? "overview" : "list"
  );
  const rawAlert = searchParams.get("alert");
  const activeAlert: LeadAlert | null = rawAlert && [
    "never_contacted", "stale", "follow_up_overdue", "exhausted",
  ].includes(rawAlert) ? rawAlert as LeadAlert : null;
  const sourceId = useState(sourceNonce)[0];
  const requestInFlight = useRef(false);
  const pendingRefresh = useRef(false);
  const sourceIdRef = useRef(sourceId);
  const loadedQueryRef = useRef(`${product}:${activeAlert ?? ""}`);
  const nameByEmail = useMemo(
    () =>
      new Map(
        assignees
          .filter((person) => person.name)
          .map((person) => [person.email, person.name as string])
      ),
    [assignees]
  );
  // No "Unassigned" entry here: the toolbar already has a dedicated Unassign
  // button, and offering the same action twice invites a manager to wonder
  // whether the two do different things. Email stays searchable because that is
  // what a manager reads off a spreadsheet.
  const assigneeOptions = useMemo(
    () =>
      assignees.map((person) => ({
        value: person.email,
        label: personLabel(person.email, nameByEmail),
        keywords: [person.email],
      })),
    [assignees, nameByEmail]
  );
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
      if (activeAlert) params.set("alert", activeAlert);
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
    const queryKey = `${product}:${activeAlert ?? ""}`;
    if (loadedQueryRef.current === queryKey) return;
    loadedQueryRef.current = queryKey;
    void reloadRef.current(0);
  }, [activeAlert, product]);

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
    // A status change or a new contact can make a row leave the active alert
    // query. Reconcile the server page so the row and the total do not remain
    // visible after the mutation that cleared its alert.
    if (activeAlert) void reloadRef.current();
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
  const displayedLeads = leads;

  function selectAlert(alert: LeadAlert) {
    setView("list");
    router.push(`/leads?product=${product}&alert=${alert}`);
  }

  function changeView(nextView: "list" | "overview") {
    setView(nextView);
    const params = new URLSearchParams(window.location.search);
    params.set("product", product);
    if (nextView === "overview") {
      params.set("view", "overview");
      params.delete("alert");
    } else {
      params.delete("view");
    }
    router.replace(`/leads?${params.toString()}`, { scroll: false });
  }

  const visibleColumns = columns.filter((column) => !column.hidden_default);
  const shellClassName = view === "list"
    ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7f9fc] text-[#172b4d]"
    : "flex min-h-full min-w-0 flex-col bg-[#f7f9fc] text-[#172b4d]";
  const alertFilterLabel = activeAlert
    ? {
        never_contacted: "Never contacted",
        stale: "Stale leads",
        follow_up_overdue: "Overdue follow-ups",
        exhausted: "Max attempts reached",
      }[activeAlert]
    : null;

  return (
    <main className={shellClassName}>
      <div className="min-w-0 shrink-0 px-6 pb-4 pt-5">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold leading-tight tracking-normal text-[#172b4d]">
              {product === "pc" ? "P&C Leads" : "Health Leads"}
            </h1>
            <p className="mt-1 text-sm font-medium text-[#6b778c]">
              {total.toLocaleString()} active leads
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isManager && <button className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0c66e4] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc]" type="button" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add lead</button>}
            {isManager && <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4]" type="button" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import</button>}
          </div>
        </header>

        <section className="mt-2 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex shrink-0 rounded bg-[#f4f5f7] p-0.5">
              {isManager && <button type="button" aria-current={view === "overview" ? "page" : undefined} className={`rounded px-3 py-1.5 text-sm font-semibold transition ${view === "overview" ? "bg-white text-[#0c66e4] shadow-sm" : "text-[#5e6c84] hover:text-[#172b4d]"}`} onClick={() => changeView("overview")}>Overview</button>}
              <button type="button" aria-current={view === "list" ? "page" : undefined} className={`rounded px-3 py-1.5 text-sm font-semibold transition ${view === "list" ? "bg-white text-[#0c66e4] shadow-sm" : "text-[#5e6c84] hover:text-[#172b4d]"}`} onClick={() => changeView("list")}>Leads</button>
            </div>
            {alertFilterLabel ? (
              <button
                type="button"
                onClick={() => router.push(`/leads?product=${product}`)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#ffbdad] bg-[#fff7f5] px-3 text-sm font-semibold text-[#bf2600] transition hover:bg-[#ffebe6]"
              >
                <CircleAlert className="h-4 w-4" />
                {alertFilterLabel}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </div>
        </section>
        </div>
      </div>

      {view === "overview" && isManager ? (
        <div className="min-w-0 flex-1 px-6 pb-6">
          <div className="mx-auto max-w-[1760px]">
            <LeadOverview key={product} product={product} onAlertClick={selectAlert} />
          </div>
        </div>
      ) : null}

      {view === "list" && isManager && selected.size > 0 && (
        <div className="min-w-0 shrink-0 px-6 pb-3">
          <div className="mx-auto max-w-[1760px] rounded border border-[#b8d4ff] bg-[#e9f2ff] px-4 py-3 text-sm shadow-[0_1px_2px_rgba(9,30,66,0.08)]">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-[#172b4d]">{selected.size} lead{selected.size === 1 ? "" : "s"} selected</span>
              <div className="min-w-[220px] flex-1">
                <TaskSelect
                  value={assignmentEmail}
                  options={assigneeOptions}
                  placeholder="Choose an agent"
                  searchable
                  personValue
                  disabled={assigning}
                  onChange={setAssignmentEmail}
                />
              </div>
              <input className="h-9 min-w-[180px] flex-1 rounded-lg border border-[#c1c7d0] bg-white px-3 text-sm outline-none transition focus:border-[#0c66e4] focus:ring-2 focus:ring-[#deebff]" placeholder="Reason (optional)" value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} disabled={assigning} />
              <button className="inline-flex h-9 items-center rounded-lg bg-[#0c66e4] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={!assignmentEmail || assigning} onClick={() => void assignSelected(assignmentEmail)}>{assigning ? "Saving..." : "Assign"}</button>
              <button className="inline-flex h-9 items-center rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={assigning} onClick={() => void assignSelected(null)}>Unassign</button>
            </div>
            {assignmentError && <p className="mt-2 text-xs font-semibold text-red-700">{assignmentError}</p>}
          </div>
        </div>
      )}

      {view === "list" && <div className="min-h-0 flex flex-1 flex-col px-6 pb-6">
        <div className="mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 flex-col">
          {displayedLeads.length === 0 ? (
            <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
              No leads match the current filters.
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-[980px] w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 z-20 border-b border-[#dfe1e6] bg-[#fafbfc] text-[11px] font-bold uppercase tracking-wide text-[#6b778c] shadow-[0_1px_0_#dfe1e6]">
                <tr>
                  {isManager && <th className="w-12 px-3 py-2"><input className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]" type="checkbox" aria-label="Select visible leads" checked={allVisibleSelected} onChange={(event) => setSelected(event.target.checked ? new Set(leads.map((lead) => lead.id)) : new Set())} /></th>}
                  <th className="w-10 px-2 py-2" aria-label="Alerts" />
                  {visibleColumns.map((column) => <th key={column.id} className="whitespace-nowrap px-3 py-2">{column.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ebecf0]">
                {displayedLeads.map((lead) => {
                  const alerts = resolveLeadAlerts(lead, lead.status_id ? statusById.get(lead.status_id) ?? null : null, alertSettings);
                  return (
                    <tr key={lead.id} className="cursor-pointer bg-white transition-colors hover:bg-[#f7faff]" onClick={() => setSelectedLead(lead)}>
                      {isManager && <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}><input className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]" type="checkbox" aria-label={`Select lead ${lead.display_number}`} checked={selected.has(lead.id)} onChange={() => toggleLead(lead.id)} /></td>}
                      <td className="px-2 py-2.5">{alerts.length > 0 && <span className={`inline-flex h-2 w-2 rounded-full ${alerts.some((alert) => ALERT_SEVERITY[alert] === "red") ? "bg-red-500" : "bg-amber-400"}`} title={alertTitle(alerts)} aria-label={alertTitle(alerts)}><CircleAlert className="sr-only" /></span>}</td>
                      {visibleColumns.map((column) => <td key={column.id} className="max-w-[240px] truncate px-3 py-2.5 font-medium text-[#172b4d]">{displayValue(lead, column, statusById, optionsByColumn, nameByEmail)}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dfe1e6] px-4 py-3 text-sm text-[#6b778c]">
            <span>{total === 0 ? "0" : `${offset + 1}–${pageEnd}`} of {total.toLocaleString()}</span>
            <div className="flex items-center gap-2">
              <button className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={offset === 0 || refreshing} onClick={() => void reload(Math.max(0, offset - limit))}><ChevronLeft className="h-4 w-4" /> Previous</button>
              <button className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={pageEnd >= total || refreshing} onClick={() => void reload(offset + limit)}>Next <ChevronRight className="h-4 w-4" /></button>
            </div>
          </footer>
            </div>
          )}
        </div>
      </div>
      }
      {view === "list" && <LeadDetailDrawer
        lead={selectedLead}
        currentEmail={currentEmail}
        sourceId={sourceId}
        statuses={statuses}
        interactionTypes={interactionTypes}
        onClose={() => setSelectedLead(null)}
        onLeadUpdated={updateLead}
        />}
      <LeadImportDialog
        open={importOpen}
        product={product}
        sourceId={sourceId}
        onClose={() => setImportOpen(false)}
        onImported={() => reload()}
      />
      <LeadAddDialog
        open={addOpen}
        product={product}
        sourceId={sourceId}
        columns={columns}
        columnOptions={columnOptions}
        statuses={statuses}
        onClose={() => setAddOpen(false)}
        onCreated={() => reload(0)}
      />
    </main>
  );
}

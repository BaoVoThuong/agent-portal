"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, Plus, Upload } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import type { LeadAlert } from "@/lib/leads/alerts";
import { isOwnLeadMutation, LEADS_TOPIC } from "@/lib/leads/realtime-topics";
import { personLabel } from "@/lib/tasks/people";
import { TaskSelect } from "../../tasks/_components/TaskSelect";
import {
  LEAD_INTERACTION_HISTORY_LIMIT,
  type LeadInteraction,
  type LeadInteractionType,
  type LeadRow,
  type LeadStatus,
} from "@/lib/leads/types";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { LeadDetailDrawer } from "./LeadDetailDrawer";
import { LeadAddDialog } from "./LeadAddDialog";
import { LeadImportDialog } from "./LeadImportDialog";
import { LeadOverview } from "./LeadOverview";
import { LeadTable } from "./LeadTable";

type LeadsClientProps = {
  /** null = every product. A filter now, not a separate screen. */
  productFilter: "pc" | "health" | null;
  currentEmail: string;
  isManager: boolean;
  initialLeads: LeadRow[];
  initialTotal: number;
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
  statuses: LeadStatus[];
  interactionTypes: LeadInteractionType[];
  /** Empty for non-managers: only they can reassign, so only they get the roster. */
  assignees: { email: string; name: string | null }[];
};

function sourceNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `lead-tab-${Math.random().toString(36).slice(2)}`;
}

export function LeadsClient({
  productFilter,
  currentEmail,
  isManager,
  initialLeads,
  initialTotal,
  columns,
  columnOptions,
  statuses,
  interactionTypes,
  assignees,
}: LeadsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState(initialLeads);
  const [total, setTotal] = useState(initialTotal);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<LeadRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assignmentEmail, setAssignmentEmail] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "overview">(() =>
    searchParams.get("view") === "overview" ? "overview" : "list",
  );
  const rawAlert = searchParams.get("alert");
  const activeAlert: LeadAlert | null =
    rawAlert &&
    ["never_contacted", "stale", "follow_up_overdue", "exhausted"].includes(
      rawAlert,
    )
      ? (rawAlert as LeadAlert)
      : null;
  const sourceId = useState(sourceNonce)[0];
  const requestInFlight = useRef(false);
  const pendingRefresh = useRef(false);
  const sourceIdRef = useRef(sourceId);
  const loadedQueryRef = useRef(`${productFilter ?? "all"}:${activeAlert ?? ""}`);
  const nameByEmail = useMemo(
    () =>
      new Map(
        assignees
          .filter((person) => person.name)
          .map((person) => [person.email, person.name as string]),
      ),
    [assignees],
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
    [assignees, nameByEmail],
  );
  const reload = async () => {
    if (requestInFlight.current) {
      pendingRefresh.current = true;
      return;
    }
    requestInFlight.current = true;
    try {
      const params = new URLSearchParams();
      if (productFilter) params.set("product", productFilter);
      if (activeAlert) params.set("alert", activeAlert);
      const response = await fetch(`/api/leads?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? "Could not refresh leads.");
      if (Array.isArray(payload?.leads)) setLeads(payload.leads as LeadRow[]);
      if (typeof payload?.total === "number") setTotal(payload.total);
      setSelected(new Set());
    } catch (error) {
      console.error("Could not refresh leads", error);
    } finally {
      requestInFlight.current = false;
      if (pendingRefresh.current) {
        pendingRefresh.current = false;
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "visible"
        )
          void reloadRef.current();
      }
    }
  };
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  useEffect(() => {
    const queryKey = `${productFilter ?? "all"}:${activeAlert ?? ""}`;
    if (loadedQueryRef.current === queryKey) return;
    loadedQueryRef.current = queryKey;
    void reloadRef.current();
  }, [activeAlert, productFilter]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const channel = supabase
      .channel(LEADS_TOPIC)
      .on("broadcast", { event: "changed" }, (message) => {
        const messageSourceId = (
          message as { payload?: { sourceId?: unknown } }
        ).payload?.sourceId;
        if (!isOwnLeadMutation(sourceIdRef.current, messageSourceId))
          void reloadRef.current();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reloadRef.current();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function updateLead(nextLead: LeadRow, interaction?: LeadInteraction) {
    const mergeLead = (currentLead: LeadRow): LeadRow => {
      const history = interaction
        ? [
            {
              id: interaction.id,
              type_id: interaction.type_id,
              occurred_at: interaction.occurred_at,
            },
            ...(currentLead.interaction_history ?? []).filter(
              (item) => item.id !== interaction.id,
            ),
          ].slice(0, LEAD_INTERACTION_HISTORY_LIMIT)
        : currentLead.interaction_history;
      return { ...nextLead, interaction_history: history };
    };
    setLeads((current) =>
      current.map((lead) => (lead.id === nextLead.id ? mergeLead(lead) : lead)),
    );
    setSelectedLead((current) =>
      current?.id === nextLead.id ? mergeLead(current) : current,
    );
    // A status change or a new contact can make a row leave the active alert
    // query. Reconcile the server page so the row and the total do not remain
    // visible after the mutation that cleared its alert.
    if (activeAlert) void reloadRef.current();
  }

  function toggleLead(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
        headers: {
          "Content-Type": "application/json",
          "x-lead-client-source": sourceId,
        },
        body: JSON.stringify({
          lead_ids: [...selected],
          to_email: toEmail,
          reason: assignmentReason,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? "Could not assign leads.");
      setAssignmentEmail("");
      setAssignmentReason("");
      setSelected(new Set());
      await reload();
    } catch (assignError) {
      setAssignmentError(
        assignError instanceof Error
          ? assignError.message
          : "Could not assign leads.",
      );
    } finally {
      setAssigning(false);
    }
  }

  const allVisibleSelected =
    leads.length > 0 && leads.every((lead) => selected.has(lead.id));
  const displayedLeads = leads;

  function selectAlert(alert: LeadAlert) {
    setView("list");
    router.push(productFilter ? `/leads?product=${productFilter}&alert=${alert}` : `/leads?alert=${alert}`);
  }

  function changeView(nextView: "list" | "overview") {
    setView(nextView);
    const params = new URLSearchParams(window.location.search);
    if (productFilter) params.set("product", productFilter);
    if (nextView === "overview") {
      params.set("view", "overview");
      params.delete("alert");
    } else {
      params.delete("view");
    }
    router.replace(`/leads?${params.toString()}`, { scroll: false });
  }

  const visibleColumns = columns.filter((column) => !column.hidden_default);
  const shellClassName =
    view === "list"
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
                Event Leads
              </h1>
              <p className="mt-1 text-sm font-medium text-[#6b778c]">
                {total.toLocaleString()} active leads
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isManager && (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0c66e4] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc]"
                  type="button"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="h-4 w-4" /> Add lead
                </button>
              )}
              {isManager && (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
                  type="button"
                  onClick={() => setImportOpen(true)}
                >
                  <Upload className="h-4 w-4" /> Import
                </button>
              )}
            </div>
          </header>

          <section className="mt-2 min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex shrink-0 rounded bg-[#f4f5f7] p-0.5">
                {isManager && (
                  <button
                    type="button"
                    aria-current={view === "overview" ? "page" : undefined}
                    className={`rounded px-3 py-1.5 text-sm font-semibold transition ${view === "overview" ? "bg-white text-[#0c66e4] shadow-sm" : "text-[#5e6c84] hover:text-[#172b4d]"}`}
                    onClick={() => changeView("overview")}
                  >
                    Overview
                  </button>
                )}
                <button
                  type="button"
                  aria-current={view === "list" ? "page" : undefined}
                  className={`rounded px-3 py-1.5 text-sm font-semibold transition ${view === "list" ? "bg-white text-[#0c66e4] shadow-sm" : "text-[#5e6c84] hover:text-[#172b4d]"}`}
                  onClick={() => changeView("list")}
                >
                  Leads
                </button>
              </div>
              {alertFilterLabel ? (
                <button
                  type="button"
                  onClick={() => router.push(productFilter ? `/leads?product=${productFilter}` : "/leads")}
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
            <LeadOverview
              key={productFilter ?? "all"}
              productFilter={productFilter}
              onAlertClick={selectAlert}
            />
          </div>
        </div>
      ) : null}

      {view === "list" && isManager && selected.size > 0 && (
        <div className="min-w-0 shrink-0 px-6 pb-3">
          <div className="mx-auto max-w-[1760px] rounded border border-[#b8d4ff] bg-[#e9f2ff] px-4 py-3 text-sm shadow-[0_1px_2px_rgba(9,30,66,0.08)]">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-[#172b4d]">
                {selected.size} lead{selected.size === 1 ? "" : "s"} selected
              </span>
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
              <input
                className="h-9 min-w-[180px] flex-1 rounded-lg border border-[#c1c7d0] bg-white px-3 text-sm outline-none transition focus:border-[#0c66e4] focus:ring-2 focus:ring-[#deebff]"
                placeholder="Reason (optional)"
                value={assignmentReason}
                onChange={(event) => setAssignmentReason(event.target.value)}
                disabled={assigning}
              />
              <button
                className="inline-flex h-9 items-center rounded-lg bg-[#0c66e4] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={!assignmentEmail || assigning}
                onClick={() => void assignSelected(assignmentEmail)}
              >
                {assigning ? "Saving..." : "Assign"}
              </button>
              <button
                className="inline-flex h-9 items-center rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={assigning}
                onClick={() => void assignSelected(null)}
              >
                Unassign
              </button>
            </div>
            {assignmentError && (
              <p className="mt-2 text-xs font-semibold text-red-700">
                {assignmentError}
              </p>
            )}
          </div>
        </div>
      )}

      {view === "list" && (
        <div className="min-h-0 flex flex-1 flex-col px-6 pb-6">
          <div className="mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 flex-col">
            <LeadTable
              leads={displayedLeads}
              columns={visibleColumns}
              statuses={statuses}
              interactionTypes={interactionTypes}
              columnOptions={columnOptions}
              nameByEmail={nameByEmail}
              isManager={isManager}
              selected={selected}
              allVisibleSelected={allVisibleSelected}
              onToggleLead={toggleLead}
              onSelectVisible={(checked) =>
                setSelected(
                  checked
                    ? new Set(leads.map((lead) => lead.id))
                    : new Set(),
                )
              }
              onOpenLead={setSelectedLead}
            />
          </div>
        </div>
      )}
      {view === "list" && (
        <LeadDetailDrawer
          lead={selectedLead}
          currentEmail={currentEmail}
          sourceId={sourceId}
          statuses={statuses}
          columns={columns}
          columnOptions={columnOptions}
          interactionTypes={interactionTypes}
          onClose={() => setSelectedLead(null)}
          onLeadUpdated={updateLead}
        />
      )}
      <LeadImportDialog
        open={importOpen}
        product={productFilter ?? "health"}
        sourceId={sourceId}
        onClose={() => setImportOpen(false)}
        onImported={() => reload()}
      />
      <LeadAddDialog
        open={addOpen}
        product={productFilter ?? "health"}
        sourceId={sourceId}
        columns={columns}
        columnOptions={columnOptions}
        assignees={assignees}
        statuses={statuses}
        onClose={() => setAddOpen(false)}
        onCreated={() => reload()}
      />
    </main>
  );
}

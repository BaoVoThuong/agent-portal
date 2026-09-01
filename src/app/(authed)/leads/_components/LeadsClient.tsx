"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, Plus, Search, Shuffle, Upload, X } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { resolveLeadAlerts, type LeadAlert } from "@/lib/leads/alerts";
import {
  classifyLeadHealth,
  emptyLeadHealthCounts,
  isLeadHealth,
  LEAD_HEALTH_BUCKETS,
  type LeadHealth,
} from "@/lib/leads/health";
import {
  settingsForLead,
  type LeadAlertSettingsByProduct,
} from "@/lib/leads/overview";
import {
  activeLeadFilterCount,
  EMPTY_LEAD_FILTERS,
  filterLeads,
  type LeadFilters,
} from "@/lib/leads/filtering";
import {
  sortLeads,
  type LeadSortKey,
  type SortDir,
} from "@/lib/leads/sorting";
import { isOwnLeadMutation, LEADS_TOPIC } from "@/lib/leads/realtime-topics";
import {
  mergeLeadPatch,
  retainSelection,
  syncSelectedLead,
} from "@/lib/leads/list-state";
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
  isManager: boolean;
  /**
   * Emails whose leads this person may edit and log against: their own plus
   * every agent they assist. null = a manager, i.e. all of them. Resolved on
   * the server from agent_members so the controls the UI offers match what the
   * API will accept.
   */
  editableOwnerEmails: string[] | null;
  /** Both threshold rows; alerts are computed per lead from its own product. */
  alertSettings: LeadAlertSettingsByProduct;
  initialLeads: LeadRow[];
  initialTotal: number;
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
  statuses: LeadStatus[];
  interactionTypes: LeadInteractionType[];
  /** Empty for non-managers: only they can reassign, so only they get the roster. */
  assignees: { email: string; name: string | null }[];
};

/**
 * TaskSelect is single-value, so "no filter" needs a value of its own. It cannot
 * be "" — that is the sentinel filterLeads reads as "still in the pool".
 */
/** One refresh per burst: a bulk assign fires one broadcast per lead. */
const REALTIME_COALESCE_MS = 400;
/** Fallback only — realtime does the real work. */
const FALLBACK_POLL_MS = 300_000;

const ALL_FILTER = "__all__";

/**
 * Nhãn cho từng nhóm. Bốn nhóm đầu là "có người phải nhấc máy", ba nhóm sau là
 * "không ai có lỗi" — và bảy nhóm này phủ hết danh sách.
 */
const LEAD_HEALTH_LABEL: Record<LeadHealth, string> = {
  never_contacted: "Never called",
  follow_up_overdue: "Overdue follow-up",
  stale: "Stale",
  exhausted: "Max attempts",
  on_track: "On track",
  unassigned: "In the pool",
  closed: "Closed (won/lost)",
};
const UNASSIGNED_FILTER = "";

const FILTER_SELECT_BUTTON_CLASS =
  "!h-9 !rounded-lg !border !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";

const PRODUCT_FILTER_OPTIONS = [
  { value: ALL_FILTER, label: "All products" },
  { value: "pc", label: "P&C" },
  { value: "health", label: "Health" },
];

function sourceNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `lead-tab-${Math.random().toString(36).slice(2)}`;
}

export function LeadsClient({
  productFilter,
  isManager,
  editableOwnerEmails,
  alertSettings,
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
  const [editError, setEditError] = useState<string | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_LEAD_FILTERS);
  const [sortKey, setSortKey] = useState<LeadSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Derived, not stored: reading the URL once meant browser Back/Forward moved
  // the address bar while the tab stayed where it was. Only a manager has an
  // Overview, so ?view=overview from anyone else falls back to the list.
  const view: "list" | "overview" =
    searchParams.get("view") === "overview" && isManager ? "overview" : "list";
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
      if (Array.isArray(payload?.leads)) {
        const refreshedLeads = payload.leads as LeadRow[];
        setLeads(refreshedLeads);
        // The detail modal owns a copy of the selected row. Keep it in sync
        // after a manager reassigns from that modal, otherwise the list refresh
        // succeeds while its Assignee field continues showing the old owner —
        // and close it outright when the row is gone rather than leaving an
        // editable-looking modal that 403s on the next save.
        setSelectedLead((current) => syncSelectedLead(current, refreshedLeads));
        // A background refresh must not throw away a bulk selection: this runs
        // on a 60-second timer and on every realtime echo of someone else's
        // edit. Clearing belongs after your own assign, which does it there.
        setSelected((current) => retainSelection(current, refreshedLeads));
      }
      if (typeof payload?.total === "number") setTotal(payload.total);
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

  // One global channel carries every lead mutation in the company, so a single
  // agent logging a call used to make all 43 people's tabs refetch their whole
  // list at once. Coalesce the burst into one refresh, and skip it entirely
  // while the tab is hidden — a background tab redrawing nothing still pays for
  // the query. A hidden tab that missed messages catches up on focus.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let timer: number | undefined;
    let missedWhileHidden = false;

    const requestReload = () => {
      if (document.visibilityState !== "visible") {
        missedWhileHidden = true;
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reloadRef.current(), REALTIME_COALESCE_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && missedWhileHidden) {
        missedWhileHidden = false;
        requestReload();
      }
    };

    const channel = supabase
      .channel(LEADS_TOPIC)
      .on("broadcast", { event: "changed" }, (message) => {
        const messageSourceId = (
          message as { payload?: { sourceId?: unknown } }
        ).payload?.sourceId;
        if (!isOwnLeadMutation(sourceIdRef.current, messageSourceId)) requestReload();
      })
      .subscribe();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, []);

  // Realtime is the primary signal; this is only the net for a dropped socket.
  // At 60s every open tab refetched the entire list every minute forever, which
  // is a standing cost for an event that usually did not happen.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reloadRef.current();
    }, FALLBACK_POLL_MS);
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
    // A status/contact change can move a row out of an alert query. Reconcile
    // the server page so the row and total never keep showing a stale match.
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

  /**
   * One inline edit. The cell has already repainted optimistically, so a
   * failure must both restore the old row and say why — a silent revert reads
   * as the app randomly discarding what someone typed.
   */
  async function patchLead(id: string, patch: Record<string, unknown>) {
    const previous = leads.find((lead) => lead.id === id);
    setLeads((current) =>
      current.map((lead) => (lead.id === id ? mergeLeadPatch(lead, patch) : lead)),
    );
    try {
      const response = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-lead-client-source": sourceId,
        },
        body: JSON.stringify(patch),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not save that change.");
      updateLead(payload.lead as LeadRow);
      // Changing Product can move a row out of a product-filtered list. The
      // alert case already reloads in updateLead(), so do not issue two fetches.
      if (!activeAlert && patch.product !== undefined) void reloadRef.current();
      setEditError(null);
    } catch (error) {
      if (previous) {
        setLeads((current) =>
          current.map((lead) => (lead.id === id ? previous : lead)),
        );
      }
      setEditError(
        error instanceof Error ? error.message : "Could not save that change.",
      );
      throw error;
    }
  }

  /** Reassigning one lead from its cell, through the route that keeps history. */
  async function assignLead(id: string, toEmail: string | null) {
    try {
      const response = await fetch("/api/leads/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-lead-client-source": sourceId,
        },
        body: JSON.stringify({ lead_ids: [id], to_email: toEmail, reason: "" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not assign that lead.");
      setSelectedLead((current) =>
        current?.id === id
          ? { ...current, assigned_to_email: toEmail }
          : current,
      );
      setEditError(null);
      await reloadRef.current();
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Could not assign that lead.",
      );
      throw error;
    }
  }

  /**
   * Xem trước trước rồi mới hỏi: "chia 137 lead (P&C 40, Health 97)?" là câu
   * người ta trả lời được, "chia pool?" thì không. Đây là hành động khó lùi.
   */
  async function openDistribute() {
    if (distributing) return;
    setDistributing(true);
    setEditError(null);
    try {
      const response = await fetch("/api/leads/distribute", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Không xem trước được.");
      if (payload.pending === 0) {
        setEditError("Không còn lead nào ở pool.");
        return;
      }
      const parts = [
        payload.byProduct.pc > 0 ? `P&C ${payload.byProduct.pc}` : null,
        payload.byProduct.health > 0 ? `Health ${payload.byProduct.health}` : null,
      ].filter(Boolean);
      const more = payload.remaining > 0 ? `\n\nCòn ${payload.remaining} lead nữa sẽ cần bấm thêm lượt.` : "";
      if (!window.confirm(`Chia ${payload.pending} lead (${parts.join(", ")}) cho agent theo tỉ lệ đã cấu hình?${more}`)) {
        return;
      }
      const run = await fetch("/api/leads/distribute", {
        method: "POST",
        headers: { "x-lead-client-source": sourceId },
      });
      const result = await run.json().catch(() => null);
      if (!run.ok) throw new Error(result?.error ?? "Không chia được.");
      const reasons = Object.values(
        (result.results ?? {}) as Record<string, { reason?: string }>
      )
        .map((entry) => entry.reason)
        .filter(Boolean);
      if (result.unassigned > 0) {
        setEditError(
          `Đã chia ${result.assigned}, còn ${result.unassigned} ở pool${
            reasons.length > 0 ? ` — ${reasons.join(" ")}` : ""
          }`
        );
      }
      await reloadRef.current();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Không chia được.");
    } finally {
      setDistributing(false);
    }
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

  // The list is fully loaded client-side (fetchAllLeads pages until complete),
  // so filtering and sorting stay in the browser — same as the task board.
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  const statusNameById = new Map(statuses.map((status) => [status.id, status.label]));
  // Event is free text on the row, so the choices are whatever the loaded leads
  // actually carry rather than a lookup table.
  const eventNames = [
    ...new Set(
      leads
        .map((lead) => lead.event_name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const assigneeFilterOptions = [
    { value: ALL_FILTER, label: "All assignees" },
    { value: UNASSIGNED_FILTER, label: "Unassigned" },
    ...assigneeOptions,
  ];
  const statusFilterOptions = [
    { value: ALL_FILTER, label: "All statuses" },
    ...statuses.map((status) => ({ value: status.id, label: status.label })),
  ];
  const eventFilterOptions = [
    { value: ALL_FILTER, label: "All events" },
    ...eventNames.map((name) => ({ value: name, label: name })),
  ];

  // resolveLeadAlerts is pure and reads four stored columns, so recomputing it
  // for every row on every render costs nothing and is always current — that is
  // why this module has no cron sweeping for overdue leads.
  const alertsByLeadId = new Map(
    leads.map((lead) => [
      lead.id,
      resolveLeadAlerts(
        lead,
        lead.status_id ? statusById.get(lead.status_id) ?? null : null,
        settingsForLead(alertSettings, lead.product),
      ),
    ]),
  );
  // Một nhóm cho mỗi lead, rời nhau — nên số ở các lựa chọn cộng lại đúng bằng
  // tổng danh sách. Badge vẫn hiện MỌI cờ của dòng đó; nhóm chỉ để lọc.
  const healthByLeadId = new Map(
    leads.map((lead) => [
      lead.id,
      classifyLeadHealth(
        lead,
        lead.status_id ? statusById.get(lead.status_id) ?? null : null,
        settingsForLead(alertSettings, lead.product),
      ),
    ]),
  );
  const healthCounts = emptyLeadHealthCounts();
  for (const bucket of healthByLeadId.values()) healthCounts[bucket] += 1;

  const healthFilterOptions = [
    { value: ALL_FILTER, label: `All leads (${leads.length})` },
    // Nhóm rỗng thì ẩn cho đỡ rối — trừ nhóm đang được chọn: nếu ẩn nó đi,
    // ô select rơi về "All leads" trong khi bộ lọc vẫn đang chạy và danh sách
    // vẫn rỗng, tức màn hình nói dối về trạng thái của chính nó.
    ...LEAD_HEALTH_BUCKETS.filter(
      (bucket) => healthCounts[bucket] > 0 || filters.health === bucket,
    ).map((bucket) => ({
      value: bucket,
      label: `${LEAD_HEALTH_LABEL[bucket]} (${healthCounts[bucket]})`,
    })),
  ];

  const displayedLeads = (() => {
    const matched = filterLeads(leads, filters, healthByLeadId);
    if (!sortKey) return matched;
    return sortLeads(matched, sortKey, sortDir, {
      statusLabel: (id) => (id ? statusNameById.get(id) ?? null : null),
      personLabel: (email) => personLabel(email, nameByEmail),
    });
  })();
  const activeFilterCount = activeLeadFilterCount(filters);
  const allVisibleSelected =
    displayedLeads.length > 0 &&
    displayedLeads.every((lead) => selected.has(lead.id));

  /** Click the same header to flip direction; a new header starts ascending. */
  function toggleSort(key: LeadSortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }

  function selectAlert(alert: LeadAlert) {
    // No setView: the URL drops ?view=overview, and view now reads the URL.
    router.push(productFilter ? `/leads?product=${productFilter}&alert=${alert}` : `/leads?alert=${alert}`);
  }

  function changeView(nextView: "list" | "overview") {
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
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={distributing}
                  onClick={() => void openDistribute()}
                  title="Chia lead đang ở pool cho agent theo tỉ lệ đã cấu hình"
                >
                  <Shuffle className="h-4 w-4" />
                  {distributing ? "Đang chia..." : "Chia pool"}
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
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
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

                {view === "list" ? (
                  <div className="relative min-w-[16rem] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a869a]" />
                    <input
                      className="h-9 w-full rounded-lg border border-[#dfe1e6] bg-white pl-9 pr-8 text-sm outline-none transition focus:border-[#0c66e4] focus:ring-2 focus:ring-[#deebff]"
                      placeholder="Search name, phone or email"
                      aria-label="Search leads"
                      value={filters.search}
                      onChange={(event) =>
                        setFilters({ ...filters, search: event.target.value })
                      }
                    />
                    {filters.search ? (
                      <button
                        type="button"
                        aria-label="Clear search"
                        onClick={() => setFilters({ ...filters, search: "" })}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#7a869a] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                ) : null}
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

            {view === "list" ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {/* Cảnh báo là lý do module này tồn tại, nhưng trước đây chỉ
                    Overview (manager-only) hiện chúng — agent không có cách nào
                    biết lead nào của mình quá hạn. Một dropdown duy nhất, các
                    nhóm rời nhau nên cộng lại đúng 100% danh sách: không lead
                    nào lọt khe giữa hai lựa chọn. */}
                <TaskSelect
                  value={filters.health ?? ALL_FILTER}
                  options={healthFilterOptions}
                  placeholder="All leads"
                  className="w-max min-w-[13rem]"
                  buttonClassName={FILTER_SELECT_BUTTON_CLASS}
                  onChange={(value) =>
                    setFilters({
                      ...filters,
                      health: isLeadHealth(value) ? value : null,
                    })
                  }
                />

                {isManager ? (
                  <TaskSelect
                    value={filters.assignedTo ?? ALL_FILTER}
                    options={assigneeFilterOptions}
                    placeholder="All assignees"
                    searchable
                    className="w-max min-w-[11rem]"
                    buttonClassName={FILTER_SELECT_BUTTON_CLASS}
                    onChange={(value) =>
                      setFilters({
                        ...filters,
                        assignedTo: value === ALL_FILTER ? null : value,
                      })
                    }
                  />
                ) : null}

                <TaskSelect
                  value={filters.statusId ?? ALL_FILTER}
                  options={statusFilterOptions}
                  placeholder="All statuses"
                  className="w-max min-w-[10rem]"
                  buttonClassName={FILTER_SELECT_BUTTON_CLASS}
                  onChange={(value) =>
                    setFilters({
                      ...filters,
                      statusId: value === ALL_FILTER ? null : value,
                    })
                  }
                />

                {productFilter === null ? (
                  <TaskSelect
                    value={filters.product ?? ALL_FILTER}
                    options={PRODUCT_FILTER_OPTIONS}
                    placeholder="All products"
                    className="w-max min-w-[9rem]"
                    buttonClassName={FILTER_SELECT_BUTTON_CLASS}
                    onChange={(value) =>
                      setFilters({
                        ...filters,
                        product:
                          value === "pc" || value === "health" ? value : null,
                      })
                    }
                  />
                ) : null}

                <TaskSelect
                  value={filters.eventName ?? ALL_FILTER}
                  options={eventFilterOptions}
                  placeholder="All events"
                  searchable
                  className="w-max min-w-[11rem]"
                  buttonClassName={FILTER_SELECT_BUTTON_CLASS}
                  onChange={(value) =>
                    setFilters({
                      ...filters,
                      eventName: value === ALL_FILTER ? null : value,
                    })
                  }
                />

                {activeFilterCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY_LEAD_FILTERS)}
                    className="h-9 shrink-0 px-1 text-sm font-medium text-[#0c66e4] transition hover:underline"
                  >
                    Clear all
                  </button>
                ) : null}

                <span className="ml-auto shrink-0 text-sm font-medium text-[#626f86]">
                  {displayedLeads.length.toLocaleString()} of{" "}
                  {leads.length.toLocaleString()} leads
                </span>
              </div>
            ) : null}
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

      {view === "list" && editError ? (
        <div className="min-w-0 shrink-0 px-6 pb-3">
          <div className="mx-auto flex max-w-[1760px] items-start justify-between gap-3 rounded border border-[#ffbdad] bg-[#fff7f5] px-4 py-2.5 text-sm font-semibold text-[#bf2600]">
            <span>{editError}</span>
            <button
              type="button"
              onClick={() => setEditError(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded px-1 transition hover:bg-[#ffebe6]"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {view === "list" && (
        <div className="min-h-0 flex flex-1 flex-col px-6 pb-6">
          <div className="mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 flex-col">
            <LeadTable
              leads={displayedLeads}
              assignees={assignees}
              editableOwnerEmails={editableOwnerEmails}
              alertsByLeadId={alertsByLeadId}
              onPatchLead={patchLead}
              onAssignLead={assignLead}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
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
                    ? new Set(displayedLeads.map((lead) => lead.id))
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
          sourceId={sourceId}
          statuses={statuses}
          columns={columns}
          columnOptions={columnOptions}
          interactionTypes={interactionTypes}
          editableOwnerEmails={editableOwnerEmails}
          isManager={isManager}
          assignees={assignees}
          nameByEmail={nameByEmail}
          onClose={() => setSelectedLead(null)}
          onPatchLead={patchLead}
          onAssignLead={assignLead}
          onLeadUpdated={updateLead}
        />
      )}
      <LeadImportDialog
        open={importOpen}
        productFilter={productFilter}
        sourceId={sourceId}
        onClose={() => setImportOpen(false)}
        onImported={() => reload()}
      />
      <LeadAddDialog
        open={addOpen}
        productFilter={productFilter}
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

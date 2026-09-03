"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, Plus, Search, Shuffle, Upload, X } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { resolveLeadAlerts, type LeadAlert } from "@/lib/leads/alerts";
import { buildStatusById } from "@/lib/leads/status-lookup";
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
import {
  LEAD_LIST_LOCKED_COLUMN_KEYS,
  toggleHiddenLeadListColumn,
  visibleLeadListColumns,
} from "@/lib/leads/list-column-visibility";
import { personLabel } from "@/lib/tasks/people";
import {
  resolveLayout,
  serializeLayout,
  type LayoutEntry,
} from "@/lib/table-config/layout";
import { TaskSelect } from "../../_components/TaskSelect";
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
import { LeadDistributeDialog } from "./LeadDistributeDialog";
import { LeadImportDialog } from "./LeadImportDialog";
import { Toast } from "../../../_shared/Toast";
import { LeadOverview } from "./LeadOverview";
import { LeadTable } from "./LeadTable";
import { LeadTableSettingsButton } from "./LeadTableSettingsButton";

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
  /** CHỈ để tra cứu hiển thị; không đưa vào danh sách chọn. */
  archivedStatuses: LeadStatus[];
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
  archivedStatuses,
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
  const [importToast, setImportToast] = useState<string | null>(null);
  /**
   * Đang hỏi ngày hẹn cho một lần đổi status.
   *
   * Status kiểu `scheduled` bắt buộc có ngày hẹn — luật đó nằm ở
   * `checkFollowUpInvariant`. Bản trước để người dùng đổi status rồi trả về lỗi
   * "That status needs a follow-up date. Open the lead to log it.", tức bắt họ
   * làm lại việc vừa làm ở một màn hình khác. Hỏi ngay rồi gửi cả hai cùng lúc.
   */
  const [followUpPrompt, setFollowUpPrompt] = useState<{
    lead: LeadRow;
    statusId: string;
  } | null>(null);
  const [followUpAt, setFollowUpAt] = useState("");
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [assignmentEmail, setAssignmentEmail] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_LEAD_FILTERS);
  const [sortKey, setSortKey] = useState<LeadSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [leadLayoutColumns, setLeadLayoutColumns] = useState<TableColumn[]>(
    columns,
  );
  const [hiddenLeadColumnKeys, setHiddenLeadColumnKeys] = useState<Set<string>>(
    () => new Set(),
  );
  /**
   * Tab đang xem. State trong trình duyệt, KHÔNG phải điều hướng.
   *
   * Bản trước gọi `router.replace` mỗi lần đổi tab, tức Next chạy lại toàn bộ
   * server component: `fetchAllLeads` (phân trang tuần tự 200 dòng/lượt, kèm
   * lịch sử tương tác cho mọi dòng) cộng bốn truy vấn nữa — chỉ để đổi một tab.
   * Task board đổi tab bằng `useState` nên tức thì; đây là lý do Event Leads
   * giật còn màn kia thì không.
   *
   * URL vẫn được cập nhật bằng `history.pushState` để link chia sẻ được và nút
   * Back vẫn chạy, nhưng `pushState` KHÔNG kích hoạt điều hướng của Next.
   *
   * Chỉ manager có Overview, nên `?view=overview` từ người khác rơi về list.
   */
  const [view, setView] = useState<"list" | "overview">(() =>
    searchParams.get("view") === "overview" && isManager ? "overview" : "list",
  );

  // Nút Back/Forward đổi URL mà không chạy lại component — phải tự đồng bộ,
  // nếu không thanh địa chỉ nói một đằng còn màn hình hiện một nẻo.
  useEffect(() => {
    const syncFromUrl = () => {
      const next = new URLSearchParams(window.location.search).get("view");
      setView(next === "overview" && isManager ? "overview" : "list");
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [isManager]);
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
  const leadLayoutHydratedRef = useRef(false);
  const leadLayoutUpdatedAtRef = useRef<string | null>(null);
  const leadLayoutSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const leadLayoutSaveSequenceRef = useRef(0);
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
  /**
   * Vá đúng những dòng vừa đổi thay vì kéo lại cả danh sách.
   *
   * Ở 5.000 lead một lần kéo lại là ~5 MB cho MỖI tab đang mở, mà nguyên nhân
   * thường chỉ là một người vừa ghi một cuộc gọi. Endpoint đi qua nguyên bộ lọc
   * phạm vi, nên nếu một id không trả về thì nó đã ra khỏi tầm nhìn của người
   * này — bỏ luôn khỏi danh sách; và nếu trả về một lead chưa có thì nó vừa
   * được gán vào, thêm vào đầu.
   */
  const patchLeadsById = async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    // Mang theo bộ lọc đang bật: server mới là nơi quyết một lead còn thuộc
    // màn hình này hay không. Thiếu nó thì lead vừa chuyển sang Won vẫn nằm
    // lại trong danh sách "quá hạn" vì nó vẫn được trả về.
    const params = new URLSearchParams({ ids: ids.join(",") });
    if (productFilter) params.set("product", productFilter);
    if (activeAlert) params.set("alert", activeAlert);
    const response = await fetch(`/api/leads?${params.toString()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("patch failed");
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload?.leads)) throw new Error("patch failed");
    const fresh = payload.leads as LeadRow[];
    const byId = new Map(fresh.map((lead) => [lead.id, lead]));
    const wanted = new Set(ids);

    setLeads((current) => {
      const seen = new Set<string>();
      const next = current
        .map((lead) => {
          if (!wanted.has(lead.id)) return lead;
          const updated = byId.get(lead.id);
          if (!updated) return null; // đã ra khỏi phạm vi
          seen.add(lead.id);
          // Lịch sử từ SERVER thắng. Giữ bản cũ là để bộ đếm cập nhật mà chip
          // lịch sử vẫn là ảnh chụp trước đó — hai phần của cùng một dòng nói
          // ngược nhau. Chỉ rơi về bản cũ khi server thật sự không trả về.
          return {
            ...updated,
            interaction_history: updated.interaction_history ?? lead.interaction_history,
          };
        })
        .filter((lead): lead is LeadRow => lead !== null);
      const added = fresh.filter((lead) => !seen.has(lead.id));
      return added.length > 0 ? [...added, ...next] : next;
    });
    setSelectedLead((current) =>
      current && byId.has(current.id)
        ? {
            ...byId.get(current.id)!,
            interaction_history:
              byId.get(current.id)!.interaction_history ?? current.interaction_history,
          }
        : current,
    );
  };
  const patchLeadsByIdRef = useRef(patchLeadsById);
  useEffect(() => {
    patchLeadsByIdRef.current = patchLeadsById;
  });

  /**
   * Trộn những dòng route vừa trả về vào danh sách đang hiển thị.
   *
   * Giống patchLeadsById nhưng KHÔNG gọi mạng: dữ liệu đã nằm trong phản hồi.
   * Sau đó vẫn hỏi lại theo id, vì người xem có phạm vi hẹp (agent/assistant)
   * có thể vừa mất quyền nhìn thấy dòng này — gán lead cho người khác là đúng
   * cái làm nó rời phạm vi của một agent.
   */
  const applyReturnedLeads = (returned: readonly LeadRow[]) => {
    if (returned.length === 0) return;
    const byId = new Map(returned.map((lead) => [lead.id, lead]));
    setLeads((current) =>
      current.map((lead) => {
        const updated = byId.get(lead.id);
        if (!updated) return lead;
        return {
          ...updated,
          interaction_history: updated.interaction_history ?? lead.interaction_history,
        };
      }),
    );
    setSelectedLead((current) =>
      current && byId.has(current.id)
        ? {
            ...byId.get(current.id)!,
            interaction_history:
              byId.get(current.id)!.interaction_history ?? current.interaction_history,
          }
        : current,
    );
    void patchLeadsByIdRef.current(returned.map((lead) => lead.id)).catch(() => {});
  };

  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  // Personal table settings reuse the generic user_table_layout API that Task
  // List uses. Admin `hidden_default` still wins; this is only each person's
  // choice about the remaining columns.
  useEffect(() => {
    if (leadLayoutHydratedRef.current) return;
    leadLayoutHydratedRef.current = true;
    let alive = true;

    void fetch("/api/config/layout?scope=lead")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { layout?: unknown; updated_at?: unknown } | null) => {
        if (!alive) return;
        leadLayoutUpdatedAtRef.current =
          typeof payload?.updated_at === "string" ? payload.updated_at : null;
        if (!Array.isArray(payload?.layout)) {
          setLeadLayoutColumns(columns);
          setHiddenLeadColumnKeys(new Set());
          return;
        }

        const resolved = resolveLayout(
          columns,
          payload.layout as LayoutEntry[],
        );
        setLeadLayoutColumns(
          resolved.map((column, index) => ({
            ...column,
            position: (index + 1) * 10,
          })),
        );
        setHiddenLeadColumnKeys(
          new Set(
            resolved
              .filter(
                (column) =>
                  column.hidden &&
                  !column.hidden_default &&
                  !column.pinned &&
                  !LEAD_LIST_LOCKED_COLUMN_KEYS.has(column.key),
              )
              .map((column) => column.key),
          ),
        );
      })
      .catch(() => {
        if (!alive) return;
        setLeadLayoutColumns(columns);
        setHiddenLeadColumnKeys(new Set());
      });

    return () => {
      alive = false;
    };
  }, [columns]);

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

    let pendingIds: string[] | null = [];

    const requestReload = (ids?: string[]) => {
      // Một tin không kèm id nghĩa là thay đổi không quy về vài dòng cụ thể
      // (import hàng loạt) — lúc đó phải tải lại cả danh sách, và nó "nuốt"
      // mọi id đang chờ trong cùng chùm.
      if (!ids) pendingIds = null;
      else if (pendingIds) pendingIds = [...new Set([...pendingIds, ...ids])];

      if (document.visibilityState !== "visible") {
        missedWhileHidden = true;
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const ready = pendingIds;
        pendingIds = [];
        if (ready && ready.length > 0 && ready.length <= 25) {
          void patchLeadsByIdRef.current(ready).catch(() => void reloadRef.current());
        } else {
          void reloadRef.current();
        }
      }, REALTIME_COALESCE_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && missedWhileHidden) {
        missedWhileHidden = false;
        // Không biết đã lỡ những gì trong lúc ẩn, nên tải lại cho chắc.
        requestReload(undefined);
      }
    };

    const channel = supabase
      .channel(LEADS_TOPIC)
      .on("broadcast", { event: "changed" }, (message) => {
        const messageSourceId = (
          message as { payload?: { sourceId?: unknown } }
        ).payload?.sourceId;
        if (isOwnLeadMutation(sourceIdRef.current, messageSourceId)) return;
        const raw = (message as { payload?: { leadIds?: unknown } }).payload?.leadIds;
        const ids =
          typeof raw === "string"
            ? raw.split(",").map((value) => value.trim()).filter(Boolean)
            : undefined;
        requestReload(ids);
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
    // Đổi status/liên hệ có thể đẩy dòng ra khỏi truy vấn cảnh báo đang bật.
    // Hỏi lại đúng dòng đó thay vì kéo cả danh sách — nếu server không trả về
    // nữa thì patchLeadsById gỡ nó khỏi màn hình.
    if (activeAlert) {
      void patchLeadsByIdRef.current([nextLead.id]).catch(() => void reloadRef.current());
    }
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
    let conflicted = false;
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
      if (!response.ok) {
        conflicted = response.status === 409;
        throw new Error(payload?.error ?? "Could not save that change.");
      }
      updateLead(payload.lead as LeadRow);
      // Changing Product can move a row out of a product-filtered list. The
      // alert case already reloads in updateLead(), so do not issue two fetches.
      // Đổi product có thể đẩy dòng ra khỏi bộ lọc product đang bật.
      if (!activeAlert && (patch.product !== undefined || patch.products !== undefined)) {
        void patchLeadsByIdRef.current([id]).catch(() => void reloadRef.current());
      }
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
      // 409 = có người ghi trước. Khôi phục xong MỚI kéo bản thật về — làm ngược
      // thứ tự thì phần khôi phục đè mất bản vừa lấy, và màn hình hiện một bản
      // cũ mà người dùng tưởng là mới nhất.
      if (conflicted) {
        void patchLeadsByIdRef.current([id]).catch(() => void reloadRef.current());
      }
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
      // Route đã trả về chính những dòng vừa đổi. Kéo lại cả danh sách để lấy
      // thứ mình đang cầm trên tay là tốn vô ích — ở 5.000 lead thì đó là vài
      // MB cho một thao tác đổi một ô.
      const returned = (payload?.leads ?? []) as LeadRow[];
      if (returned.length > 0) {
        applyReturnedLeads(returned);
      } else {
        setSelectedLead((current) =>
          current?.id === id ? { ...current, assigned_to_email: toEmail } : current,
        );
        await reloadRef.current();
      }
      setEditError(null);
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Could not assign that lead.",
      );
      throw error;
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
      const returned = (payload?.leads ?? []) as LeadRow[];
      if (returned.length > 0) applyReturnedLeads(returned);
      else await reload();
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
  // Gồm cả status đã archive: lead cũ vẫn trỏ vào đó, và thiếu chúng thì
  // resolveLeadAlerts nhận null rồi coi lead đã chốt là còn mở — sáng cờ đỏ.
  const statusById = buildStatusById(statuses, archivedStatuses);
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
        settingsForLead(alertSettings, lead),
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
        settingsForLead(alertSettings, lead),
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
    // Đây PHẢI là điều hướng thật: bộ lọc cảnh báo đổi câu truy vấn phía server,
    // nên trang cần được dựng lại. Khác hẳn việc đổi tab, vốn chỉ đổi thứ đang
    // hiển thị từ dữ liệu đã có.
    setView("list");
    router.push(productFilter ? `/tasks/leads?product=${productFilter}&alert=${alert}` : `/tasks/leads?alert=${alert}`);
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
    setView(nextView);
    // `history.pushState` chứ không phải `router.replace`: nó cập nhật thanh địa
    // chỉ và ngăn xếp Back mà KHÔNG bắt Next chạy lại server component.
    window.history.pushState(null, "", `/tasks/leads?${params.toString()}`);
  }

  function saveLeadTableLayout(hiddenKeys: ReadonlySet<string>) {
    const sequence = ++leadLayoutSaveSequenceRef.current;
    const save = async () => {
      // Keep only the latest checkbox state when someone toggles several
      // columns quickly; an old response must never overwrite a newer intent.
      if (sequence !== leadLayoutSaveSequenceRef.current) return;

      const layout = serializeLayout(
        leadLayoutColumns.map((column) => ({
          ...column,
          width: null,
          hidden:
            !column.hidden_default &&
            !column.pinned &&
            !LEAD_LIST_LOCKED_COLUMN_KEYS.has(column.key) &&
            hiddenKeys.has(column.key),
        })),
      );
      const response = await fetch("/api/config/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "lead",
          layout,
          expected_updated_at: leadLayoutUpdatedAtRef.current,
        }),
      }).catch(() => null);

      if (response?.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { updated_at?: unknown }
          | null;
        if (typeof payload?.updated_at === "string") {
          leadLayoutUpdatedAtRef.current = payload.updated_at;
        }
        return;
      }

      const payload = (await response?.json().catch(() => null)) as
        | { error?: unknown }
        | null
        | undefined;
      setEditError(
        typeof payload?.error === "string"
          ? payload.error
          : "Could not save the table layout.",
      );
    };

    const queued = leadLayoutSaveQueueRef.current.then(save, save);
    leadLayoutSaveQueueRef.current = queued.catch(() => undefined);
    void queued;
  }

  function toggleLeadListColumn(key: string) {
    setHiddenLeadColumnKeys((current) => {
      const next = toggleHiddenLeadListColumn(current, key);
      if (next.size === current.size && [...next].every((item) => current.has(item))) {
        return current;
      }
      void saveLeadTableLayout(next);
      return next;
    });
  }

  const visibleColumns = useMemo(
    () => visibleLeadListColumns(leadLayoutColumns, hiddenLeadColumnKeys),
    [hiddenLeadColumnKeys, leadLayoutColumns],
  );
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
                  onClick={() => setDistributeOpen(true)}
                  title="Distribute pooled leads to agents by the configured ratio"
                >
                  <Shuffle className="h-4 w-4" /> Distribute pool
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
                  onClick={() => router.push(productFilter ? `/tasks/leads?product=${productFilter}` : "/tasks/leads")}
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

                <LeadTableSettingsButton
                  columns={leadLayoutColumns}
                  hiddenColumnKeys={hiddenLeadColumnKeys}
                  onToggleColumn={toggleLeadListColumn}
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
              onFollowUpNeeded={(lead, statusId) =>
                setFollowUpPrompt({ lead, statusId })
              }
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
          archivedStatuses={archivedStatuses}
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
      <LeadDistributeDialog
        open={distributeOpen}
        nameByEmail={nameByEmail}
        sourceId={sourceId}
        onClose={() => setDistributeOpen(false)}
        onDistributed={() => void reloadRef.current()}
      />
      {followUpPrompt ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[#091e42]/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Set follow-up date"
          onClick={() => setFollowUpPrompt(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-base font-bold text-[#172b4d]">
              When will you call back?
            </h2>
            <p className="mt-1 text-sm text-[#6b778c]">
              {statusById.get(followUpPrompt.statusId)?.label ?? "This status"}{" "}
              needs a follow-up time, otherwise the lead sits flagged forever.
            </p>
            <input
              type="datetime-local"
              autoFocus
              value={followUpAt}
              onChange={(event) => setFollowUpAt(event.target.value)}
              className="mt-3 h-10 w-full rounded border-2 border-[#dfe1e6] px-3 text-sm font-medium text-[#172b4d] outline-none focus:border-[#0c66e4]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setFollowUpPrompt(null);
                  setFollowUpAt("");
                }}
                className="h-9 rounded border border-[#dfe1e6] bg-white px-3 text-sm font-bold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!followUpAt || followUpSaving}
                onClick={async () => {
                  const prompt = followUpPrompt;
                  if (!prompt || !followUpAt) return;
                  setFollowUpSaving(true);
                  try {
                    // Gửi CẢ HAI trong một lần: status và ngày hẹn là một cặp
                    // bất khả phân, gửi riêng thì lần gửi đầu đã vi phạm luật.
                    await patchLead(prompt.lead.id, {
                      status_id: prompt.statusId,
                      next_follow_up_at: new Date(followUpAt).toISOString(),
                    });
                    setFollowUpPrompt(null);
                    setFollowUpAt("");
                  } catch {
                    // patchLead đã đặt thông báo lỗi và trả dòng về như cũ.
                  } finally {
                    setFollowUpSaving(false);
                  }
                }}
                className="h-9 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {followUpSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <Toast
        message={importToast}
        tone="success"
        onDismiss={() => setImportToast(null)}
      />
      <LeadImportDialog
        open={importOpen}
        productFilter={productFilter}
        columns={columns}
        sourceId={sourceId}
        onClose={() => setImportOpen(false)}
        onImported={async (result) => {
          await reload();
          // Báo bằng toast thay vì giữ modal: lượt import sạch thì bảng kết quả
          // chỉ có một con số. Modal chỉ ở lại khi có thứ đáng đọc.
          const parts = [`Imported ${result.inserted.toLocaleString()} lead${result.inserted === 1 ? "" : "s"}`];
          if (result.duplicates > 0) parts.push(`${result.duplicates} duplicate`);
          if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);
          setImportToast(`${parts.join(" · ")}.`);
        }}
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

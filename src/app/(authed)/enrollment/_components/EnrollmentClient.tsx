"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  ExternalLink,
  Paperclip,
  Plus,
  Search,
  Settings2,
  UserPlus,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { isOwnRealtimeMutation } from "@/lib/tasks/realtime-topics";
import {
  OPEN_ENROLLMENT_EVENT,
  createEnrollmentDataInvalidationSourceId,
  publishEnrollmentDataInvalidation,
  subscribeEnrollmentDataInvalidation,
  writeEnrollmentDeepLink,
} from "@/lib/enrollment/client-events";
import {
  ENROLLMENT_DETAIL_OPEN_FRESH_MS,
  fetchEnrollmentDetail,
  getCachedEnrollmentDetail,
  getCachedEnrollmentDetailAgeMs,
  prefetchEnrollmentDetail,
  refreshEnrollmentDetail,
  setCachedEnrollmentDetail,
} from "@/lib/enrollment/detail-cache";
import {
  ENROLLMENT_MUTATION_SOURCE_HEADER,
  enrollmentReactionTopic,
  enrollmentRoomTopic,
  enrollmentTopic,
} from "@/lib/enrollment/realtime-topics";
import {
  canRefreshEnrollmentData,
  ENROLLMENT_LIVE_EVENT_DEBOUNCE_MS,
  ENROLLMENT_LIVE_REFRESH_THROTTLE_MS,
  enrollmentBroadcastReconcileScope,
  enrollmentInvalidationReconcileScope,
  enrollmentLivePollInterval,
  type EnrollmentLiveStatus,
} from "@/lib/enrollment/live-sync";
import { TABLE_CONFIG_TOPIC } from "@/lib/table-config/realtime-topics";
import {
  COMMENT_PAGE_SIZE,
  COMMENT_REFRESH_MAX,
} from "@/lib/collaboration/comment-pagination";
import {
  enrollmentDisplayKey,
  formatDateInput,
  optionLabel,
} from "@/lib/enrollment/helpers";
import { buildEnrollmentSearchHaystack } from "@/lib/enrollment/filtering";
import { resolveEnrollmentCapabilities } from "@/lib/enrollment/access";
import {
  compareEnrollmentOptionText,
  emptyEnrollmentOptionsBySet,
  optionById,
  sortEnrollmentOptionsByLabel,
  type EnrollmentOptionsBySet,
} from "@/lib/enrollment/options";
import { findInvalidEnrollmentOptionFields } from "@/lib/enrollment/form-options";
import {
  ENROLLMENT_PROGRAMS,
  ENROLLMENT_PROGRAM_LABELS,
  type EnrollmentDetail,
  type EnrollmentOption,
  type EnrollmentOptionSetKey,
  type EnrollmentPerson,
  type EnrollmentProgram,
  type EnrollmentRecordWithStats,
} from "@/lib/enrollment/types";
import {
  enrollmentIdentityBadgeStyle,
  enrollmentStateBadgeStyle,
} from "@/lib/enrollment/option-badge";
import {
  readHiddenColumns,
  toggleHiddenColumn,
  writeHiddenColumns,
} from "@/lib/enrollment/column-visibility";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import { formatEmailAsName, personLabel } from "@/lib/tasks/people";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import {
  resolveLayout,
  serializeLayout,
  type LayoutEntry,
} from "@/lib/table-config/layout";
import { EditableCustomCell } from "../../_shared/EditableCustomCell";
import { ControlledCustomField } from "../../_shared/ControlledCustomField";
import { SearchableListboxPanel } from "../../_shared/SearchableListboxPanel";
import { Toast } from "../../_shared/Toast";
import { CommentThread } from "../../tasks/_components/CommentThread";
import { ActivityFeed } from "../../tasks/_components/ActivityFeed";
import { AttachmentStrip } from "../../tasks/_components/AttachmentStrip";
import {
  AttachmentPreviewDialog,
  type AttachmentPreview,
} from "../../tasks/_components/AttachmentPreviewDialog";
import { TaskSelect } from "../../tasks/_components/TaskSelect";
import { TASK_ASSIGNEE_BUTTON_CLASS } from "../../tasks/_components/TaskAssigneePicker";
import { DateRangeFilter, type TaskDateRangeValue } from "../../tasks/_components/TaskToolbar";
import { ReasonModal } from "../../tasks/_components/ReasonModal";
import { useAnchoredMenu } from "../../tasks/_components/use-anchored-menu";
import {
  addPendingFiles,
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  removePendingFile,
  type PendingFile,
} from "@/lib/tasks/pending-attachments";
import { formatAttachmentSize } from "@/lib/tasks/attachments";
import { AvatarStack, Initials } from "../../tasks/_components/board-ui";
import { applyFrozenOrder } from "@/lib/tasks/frozen-order";
import { toOptimisticEnrollmentPatch } from "@/lib/enrollment/optimistic-patch";
import { EnrollmentOverview } from "./EnrollmentOverview";

type SortKey =
  | "key"
  | "client"
  | "stage"
  | "caller"
  | "responsible"
  | "payment"
  | "carrier"
  | "aca"
  | "consent"
  | "platform"
  | "pcp2025"
  | "pcp2026"
  | "due"
  | "attention"
  | "qc"
  | "createdBy"
  | "createdAt"
  | "updatedBy"
  | "updated"
  | "comments";
type SortDir = "asc" | "desc";

type Filters = {
  query: string;
  stage: string[];
  agent: string[];
  caller: string[];
  responsible: string[];
  mineOnly: boolean;
  carrier: string[];
  attention: boolean;
  qcNeeded: boolean;
  unowned: boolean;
  createdFrom: string;
  createdTo: string;
};

type PendingEnrollmentPatch = {
  sequence: number;
  /** What goes on the wire. May contain request-only keys such as qc_checked. */
  patch: Record<string, unknown>;
  /**
   * The same change in real column names, computed once at enqueue so the first
   * optimistic merge and every later rebase agree. Replaying `patch` here would
   * reintroduce the bug where qc_checked never reached the rendered row.
   */
  columnPatch: Record<string, unknown>;
};

type EnrollmentMutationState = {
  confirmed: EnrollmentRecordWithStats;
  pending: PendingEnrollmentPatch[];
  nextSequence: number;
  tail: Promise<void>;
};

const DEFAULT_FILTERS: Filters = {
  query: "",
  stage: [],
  agent: [],
  caller: [],
  responsible: [],
  mineOnly: false,
  carrier: [],
  attention: false,
  qcNeeded: false,
  unowned: false,
  createdFrom: "",
  createdTo: "",
};

const FILTER_SELECT_BUTTON_CLASS =
  "!h-9 !rounded-lg !border !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";
const INPUT_CLASS =
  "w-full rounded border-2 border-[#dfe1e6] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:border-[#dfe1e6] disabled:bg-[#f4f5f7] disabled:text-[#6b778c]";
const DETAIL_FIELD_BUTTON_CLASS =
  "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-left text-sm font-semibold text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4]";
const DETAIL_FIELD_INPUT_CLASS =
  "h-9 w-full rounded-lg border-2 border-[#dfe1e6] bg-white px-2 text-sm font-semibold text-[#172b4d] outline-none transition focus:border-[#0c66e4]";
const DETAIL_FIELD_DISPLAY_CLASS =
  "h-9 w-full rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-left text-sm font-semibold text-[#172b4d] hover:border-[#c1c7d0] hover:bg-white disabled:bg-[#f4f5f7]";
const LABEL_CLASS =
  "text-xs font-bold uppercase tracking-wide text-[#6b778c]";
// shrink-0: these sit above the comment thread in a flex column, so they must
// keep their natural height and let the thread absorb the leftover space.
const COMPACT_DETAIL_FIELD_CLASS = "block shrink-0 space-y-1";
const COMPACT_DETAIL_INPUT_CLASS = `${INPUT_CLASS} h-9 !px-2 !py-1.5 font-semibold`;
const COMPACT_DESCRIPTION_CLASS = `${INPUT_CLASS} min-h-[72px] max-h-[138px] resize-none overflow-x-hidden !px-2 !py-2 leading-6`;
const CREATE_DESCRIPTION_CLASS =
  "min-h-[21rem] w-full resize-none rounded border-2 border-[#dfe1e6] bg-white px-3 py-3 text-sm leading-6 text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
const INVALID_RING_CLASS = "!ring-2 !ring-[#ff5630] !ring-offset-1";
const REQUIRED_MARK = <span className="text-[#bf2600]"> *</span>;

function thisMonthDateRange(): TaskDateRangeValue {
  const today = new Date();
  const dateKey = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { from: dateKey(new Date(today.getFullYear(), today.getMonth(), 1)), to: dateKey(today) };
}

function autosizeTextarea(textarea: HTMLTextAreaElement | null): number {
  if (!textarea) return 0;
  textarea.style.overflowY = "hidden";
  textarea.style.height = "auto";
  const contentHeight = textarea.scrollHeight;
  textarea.style.height = `${Math.min(138, Math.max(72, contentHeight))}px`;
  if (contentHeight > 138) textarea.style.overflowY = "auto";
  return contentHeight;
}

// Column layout for the enrollment list — mirrors the Slack List this module
// replaces: every field is its own fixed-width column so the table scrolls
// horizontally instead of hiding data. "sticky" columns (Key, Client) stay
// pinned on the left while the rest scrolls underneath, same as Slack.
type EnrollmentColumn = {
  key: SortKey | "fub" | (string & {});
  label: string;
  width: number;
  sticky?: boolean;
  // Hard, code-level floor mirroring TASK_LIST_COLUMNS' `locked` for CS: Key
  // and Client Name must always render and always stay toggle/archive-proof,
  // even if an admin unpins them (or, in theory, sets hidden_default on them)
  // in Config Table. Unlike `sticky`/pinned, this is never admin-configurable.
  locked?: boolean;
  sortable?: boolean;
  align?: "center";
  configColumn?: TableColumn;
};
type EnrollmentColumnKey = EnrollmentColumn["key"];

// Base (ACA) column set — every field ACA uses. Medicare has no
// Payment/Consent/Platform/AC concepts and only one owner/PCP field (see the
// real Medicare Slack List), so enrollmentColumnsForProgram() below derives a
// trimmed, relabeled set from this instead of duplicating the whole table.
const ACA_ENROLLMENT_COLUMNS: EnrollmentColumn[] = [
  { key: "key", label: "Key", width: 100, sticky: true, locked: true, sortable: true },
  { key: "client", label: "Client Name", width: 300, sticky: true, locked: true, sortable: true },
  { key: "agent", label: "Agent", width: 170, sortable: true },
  { key: "stage", label: "Stage", width: 260, sortable: true },
  { key: "caller", label: "Caller", width: 180, sortable: true },
  { key: "responsible", label: "Responsible Enroll", width: 200, sortable: true },
  { key: "payment", label: "Payment status", width: 180, sortable: true },
  { key: "carrier", label: "Carrier", width: 170, sortable: true },
  { key: "aca", label: "AC", width: 280, sortable: true },
  { key: "consent", label: "Consent", width: 104, sortable: true, align: "center" },
  { key: "platform", label: "Platform", width: 110, sortable: true },
  { key: "pcp2025", label: "PCP 2025", width: 180, sortable: true },
  { key: "pcp2026", label: "PCP 2026", width: 180, sortable: true },
  { key: "due", label: "Due Date", width: 110, sortable: true },
  { key: "createdBy", label: "Created by", width: 130, sortable: true },
  { key: "createdAt", label: "Created time", width: 120, sortable: true },
  { key: "updatedBy", label: "Last edited by", width: 130, sortable: true },
  { key: "updated", label: "Last edited time", width: 130, sortable: true },
  { key: "qc", label: "QC", width: 64, align: "center", sortable: true },
];

// Medicare's real Slack List has no Payment/Consent/Platform/AC columns and a
// single Assignee + single PCP (no Caller/Responsible split, no PCP 2025/2026
// split) — drop what doesn't apply and relabel what's shared but named
// differently, rather than showing empty N/A columns for every Medicare row.
const MEDICARE_HIDDEN_COLUMNS = new Set<EnrollmentColumn["key"]>([
  "caller",
  "payment",
  "aca",
  "consent",
  "platform",
  "pcp2026",
]);
const MEDICARE_COLUMN_LABELS: Partial<Record<EnrollmentColumn["key"], string>> = {
  responsible: "Assignee",
  pcp2025: "PCP",
};

function enrollmentColumnsForProgram(
  program: EnrollmentProgram,
  configuredColumns: TableColumn[] = []
): EnrollmentColumn[] {
  const baseColumns =
    program === "medicare"
      ? ACA_ENROLLMENT_COLUMNS.filter((column) => !MEDICARE_HIDDEN_COLUMNS.has(column.key)).map(
          (column) =>
            MEDICARE_COLUMN_LABELS[column.key]
              ? { ...column, label: MEDICARE_COLUMN_LABELS[column.key]! }
              : column
        )
      : ACA_ENROLLMENT_COLUMNS;

  if (configuredColumns.length === 0) return baseColumns;
  const byKey = new Map(baseColumns.map((column) => [column.key, column]));
  const ordered = configuredColumns
    .filter((column) =>
      column.is_system ? byKey.has(column.key as EnrollmentColumnKey) : true
    )
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  const next: EnrollmentColumn[] = [];
  const used = new Set<EnrollmentColumnKey>();
  for (const configured of ordered) {
    const key = configured.key as EnrollmentColumnKey;
    const base = byKey.get(key);
    if (configured.is_system) {
      if (!base) continue;
      next.push({
        ...base,
        label: configured.label,
        sticky: configured.pinned,
        configColumn: configured,
      });
    } else {
      next.push({
        key,
        label: configured.label,
        width: configured.type === "checkbox" ? 110 : 180,
        sticky: configured.pinned,
        align: configured.type === "checkbox" ? "center" : undefined,
        configColumn: configured,
      });
    }
    used.add(key);
  }
  for (const column of baseColumns) {
    if (!used.has(column.key)) next.push(column);
  }
  // hidden_default = archived: dropped from the column set entirely, for
  // every viewer, before any per-user filter (hiddenColumnKeys/localStorage,
  // saved layout) ever runs — so no personal preference can bring it back.
  // `locked` columns (Key/Client) are the one hard exception: they must
  // always render no matter what an admin does in Config Table.
  const kept = next.filter((column) => column.locked || !column.configColumn?.hidden_default);
  return [
    ...kept.filter((column) => column.sticky),
    ...kept.filter((column) => !column.sticky),
  ];
}

function browserStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function useHiddenEnrollmentColumns(
  program: EnrollmentProgram,
  columns: readonly EnrollmentColumn[]
) {
  const [hiddenByProgram, setHiddenByProgram] = useState<
    Record<EnrollmentProgram, Set<EnrollmentColumnKey>>
  >(() =>
    Object.fromEntries(
      ENROLLMENT_PROGRAMS.map((value) => [value, new Set<EnrollmentColumnKey>()])
    ) as Record<EnrollmentProgram, Set<EnrollmentColumnKey>>
  );
  const localStorageHydratedRef = useRef(new Set<EnrollmentProgram>());
  const hiddenKeys = hiddenByProgram[program];
  const validKeys = useMemo(
    () => new Set(columns.map((column) => column.key)),
    [columns]
  );
  const defaultHiddenKeys = useMemo(
    () =>
      new Set(
        columns
          .filter((column) => column.configColumn?.hidden_default)
          .map((column) => column.key)
      ),
    [columns]
  );

  useEffect(() => {
    if (localStorageHydratedRef.current.has(program)) return;
    localStorageHydratedRef.current.add(program);
    const timer = window.setTimeout(() => {
      setHiddenByProgram(
        Object.fromEntries(
          ENROLLMENT_PROGRAMS.map((value) => [
            value,
            readHiddenColumns(
              browserStorage(),
              value,
              validKeys,
              value === program ? defaultHiddenKeys : new Set()
            ) as Set<EnrollmentColumnKey>,
          ])
        ) as Record<EnrollmentProgram, Set<EnrollmentColumnKey>>
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [defaultHiddenKeys, program, validKeys]);

  const toggleColumn = useCallback(
    (key: EnrollmentColumnKey) => {
      const column = columns.find((item) => item.key === key);
      setHiddenByProgram((current) => {
        const next = toggleHiddenColumn(
          current[program],
          key,
          Boolean(column?.sticky || column?.locked)
        ) as Set<EnrollmentColumnKey>;
        writeHiddenColumns(browserStorage(), program, next);
        return { ...current, [program]: next };
      });
    },
    [columns, program]
  );

  const setProgramHiddenKeys = useCallback(
    (keys: Set<EnrollmentColumnKey>) => {
      setHiddenByProgram((current) => ({ ...current, [program]: keys }));
      writeHiddenColumns(browserStorage(), program, keys);
    },
    [program]
  );

  return [hiddenKeys, toggleColumn, setProgramHiddenKeys] as const;
}

// Left offset of each sticky column = sum of widths of sticky columns before it.
function stickyOffset(columns: EnrollmentColumn[], columnKey: EnrollmentColumn["key"]): number {
  let offset = 0;
  for (const column of columns) {
    if (column.key === columnKey) return offset;
    if (column.sticky) offset += column.width;
  }
  return offset;
}

// Single source of truth for a column's pixel width — row cells read from this
// instead of repeating the number, so widening a column can't silently drift
// out of sync with the rendered rows.
function colWidth(columns: EnrollmentColumn[], key: EnrollmentColumn["key"]): number {
  return columns.find((column) => column.key === key)?.width ?? 120;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveEnrollmentRecordCapabilitiesClient(
  record: Pick<
    EnrollmentRecordWithStats,
    | "agent_email"
    | "caller_email"
    | "responsible_enroll_email"
    | "created_by_email"
  >,
  currentEmail: string,
  isManager: boolean,
  agentScopeEmails: readonly string[]
) {
  const normalizedActor = normalizeEnrollmentEmail(currentEmail);
  const normalizedAgent = normalizeEnrollmentEmail(record.agent_email);
  const coveredAgents = new Set(agentScopeEmails.map(normalizeEnrollmentEmail));
  return resolveEnrollmentCapabilities(
    { email: currentEmail, isManager, isWorker: true },
    {
      isAgentOwner: Boolean(normalizedAgent && coveredAgents.has(normalizedAgent)),
      isCaller:
        normalizeEnrollmentEmail(record.caller_email) === normalizedActor,
      isResponsible:
        normalizeEnrollmentEmail(record.responsible_enroll_email) ===
        normalizedActor,
      isCreator:
        normalizeEnrollmentEmail(record.created_by_email) === normalizedActor,
    }
  );
}

function normalizeEnrollmentEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

export function EnrollmentClient({
  program,
  initialRecords,
  people,
  agents,
  initialOptions,
  tableColumns,
  tableColumnOptions,
  currentEmail,
  myAgents,
  myAssistantAgents,
  defaultToOwnAssignments,
  canManageOptions,
  canExport,
}: {
  program: EnrollmentProgram;
  initialRecords: EnrollmentRecordWithStats[];
  people: EnrollmentPerson[];
  agents: TaskAgent[];
  initialOptions: EnrollmentOption[];
  tableColumns: TableColumn[];
  tableColumnOptions: TableColumnOption[];
  currentEmail: string;
  myAgents: string[];
  myAssistantAgents: string[];
  defaultToOwnAssignments: boolean;
  canManageOptions: boolean;
  canExport: boolean;
}) {
  const [records, setRecords] = useState(initialRecords);
  const [options, setOptions] = useState(initialOptions);
  const [view, setView] = useState<"list" | "overview">("list");
  // Keep the client-side view fail-closed as well as the API. Enrollment
  // overview is manager-only, matching the CS board's hidden Overview tab.
  const visibleView = canManageOptions ? view : "list";
  const [filters, setFilters] = useState<Filters>(() =>
    defaultToOwnAssignments
      ? { ...DEFAULT_FILTERS, responsible: [currentEmail], mineOnly: true }
      : DEFAULT_FILTERS
  );
  const [overviewDateRanges, setOverviewDateRanges] = useState<
    Record<EnrollmentProgram, TaskDateRangeValue>
  >(() => ({ aca: { from: "", to: "" }, medicare: thisMonthDateRange() }));
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "attention",
    dir: "desc",
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [layoutTableColumns, setLayoutTableColumns] = useState<TableColumn[]>(tableColumns);
  const [error, setError] = useState<string | null>(null);
  const [configStale, setConfigStale] = useState(false);
  const [liveStatus, setLiveStatus] = useState<EnrollmentLiveStatus>("connecting");
  const recordRowsRef = useRef(new Map(initialRecords.map((record) => [record.id, record])));
  const recordMutationStatesRef = useRef(new Map<string, EnrollmentMutationState>());
  const pendingRef = useRef(new Map<string, number>());
  const writeVersionRef = useRef(0);
  const lastForegroundRefreshAtRef = useRef(0);
  const [liveSourceId] = useState(() =>
    createEnrollmentDataInvalidationSourceId(`enrollment-${program}`),
  );
  // Refetch sequencing. A GET issued BEFORE a write commits can resolve AFTER
  // it, and would then overwrite the fresh row with a pre-write snapshot —
  // the A→B→A→B revert. Two rules close it, both evaluated against state
  // captured at ISSUE time rather than at response time:
  //   1. only the newest refetch may apply (refetchSeqRef),
  //   2. a refetch issued while any write was in flight can never apply.
  // When a refetch is dropped we set refetchDirtyRef so the update is
  // re-run once writes settle, instead of being silently discarded.
  const refetchSeqRef = useRef(0);
  const refetchDirtyRef = useRef(false);
  // Keep list refreshes single-flight. Enrollment list responses also hydrate
  // comment and attachment metadata, so overlapping realtime/focus/poll
  // requests are especially expensive and can make the UI appear to jump
  // between snapshots. A trigger that arrives during a request becomes one
  // trailing refresh, matching the task board's stale-while-revalidate flow.
  const recordsRefetchInFlightRef = useRef<Promise<void> | null>(null);
  const recordsRefetchQueuedRef = useRef(false);
  const enrollmentLayoutHydratedRef = useRef(false);
  const enrollmentLayoutUpdatedAtRef = useRef<string | null>(null);
  const enrollmentLayoutSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const enrollmentLayoutSaveSequenceRef = useRef(0);
  const enrollmentLayoutProgramRef = useRef(program);
  const enrollmentLayoutBaselineRef = useRef<string | null>(null);
  const optionsRequestSequenceRef = useRef(0);

  function updateRecords(updater: (current: EnrollmentRecordWithStats[]) => EnrollmentRecordWithStats[]) {
    setRecords((current) => {
      const next = updater(current);
      if (next !== current) {
        recordRowsRef.current = new Map(next.map((record) => [record.id, record]));
      }
      return next;
    });
  }

  function beginPending(key: string) {
    pendingRef.current.set(key, (pendingRef.current.get(key) ?? 0) + 1);
    return () => {
      const remaining = (pendingRef.current.get(key) ?? 1) - 1;
      if (remaining > 0) pendingRef.current.set(key, remaining);
      else pendingRef.current.delete(key);
      flushDeferredRefetch();
    };
  }

  const optionsById = useMemo(() => optionById(options), [options]);
  const optionsBySet = useMemo(() => groupOptions(options), [options]);
  const columns = useMemo(
    () => enrollmentColumnsForProgram(program, layoutTableColumns),
    [program, layoutTableColumns]
  );
  // Label source for surfaces that don't get the per-user-filtered list —
  // built from `columns` (already resolves live label/position/Medicare
  // overrides over defaults), never from a second independent derivation.
  const columnByKey = useMemo(() => {
    const labels = new Map<string, { label: string }>(
      layoutTableColumns.map((column) => [column.key, { label: column.label }])
    );
    // Program-specific labels (for example Medicare Assignee/PCP) override
    // the shared config label. FUB stays in this label map even though its
    // List presentation is embedded in Client Name rather than a standalone
    // column.
    for (const column of columns) labels.set(column.key, { label: column.label });
    return labels;
  }, [columns, layoutTableColumns]);
  const [hiddenColumnKeys, toggleColumn, setHiddenColumnKeys] =
    useHiddenEnrollmentColumns(program, columns);
  const visibleColumns = useMemo(
    () =>
      columns.filter(
        (column) => column.locked || column.sticky || !hiddenColumnKeys.has(column.key)
      ),
    [columns, hiddenColumnKeys]
  );
  // Admin-level visibility for the Create dialog + Detail drawer — computed
  // straight from the raw column config, deliberately NOT from
  // visibleColumns above (that one also folds in this specific user's
  // personal List/Board column-hide state via hiddenColumnKeys, which must
  // never affect whether a field can be created/edited).
  const adminVisibleColumnKeys = useMemo(
    () =>
      new Set(
        layoutTableColumns
          .filter((column) => !column.archived_at && !column.hidden_default)
          .map((column) => column.key)
      ) as ReadonlySet<EnrollmentColumnKey>,
    [layoutTableColumns]
  );
  const requiredColumnKeys = useMemo(
    () =>
      new Set(
        layoutTableColumns
          .filter((column) => column.required && !column.archived_at)
          .map((column) => column.key)
      ),
    [layoutTableColumns]
  );
  const detailCustomColumns = useMemo(
    () =>
      layoutTableColumns.filter(
        (column) =>
          column.show_in_detail &&
          !column.is_system &&
          !column.archived_at &&
          (column.required || !column.hidden_default)
      ),
    [layoutTableColumns]
  );
  const createCustomColumns = useMemo(
    () =>
      layoutTableColumns.filter(
        (column) =>
          !column.is_system &&
          !column.archived_at &&
          (column.required || !column.hidden_default)
      ),
    [layoutTableColumns]
  );

  useEffect(() => {
    let alive = true;
    enrollmentLayoutProgramRef.current = program;
    enrollmentLayoutUpdatedAtRef.current = null;
    enrollmentLayoutBaselineRef.current = null;
    enrollmentLayoutSaveSequenceRef.current += 1;
    enrollmentLayoutHydratedRef.current = false;
    const resetTimer = window.setTimeout(() => {
      if (alive) setLayoutTableColumns(tableColumns);
    }, 0);
    void fetch(`/api/config/layout?scope=${program}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { layout?: unknown; updated_at?: unknown } | null) => {
        if (!alive) return;
        enrollmentLayoutUpdatedAtRef.current =
          typeof payload?.updated_at === "string" ? payload.updated_at : null;
        if (Array.isArray(payload?.layout)) {
          const resolved = resolveLayout(tableColumns, payload.layout as LayoutEntry[]);
          setLayoutTableColumns(
            // Keep hidden_default as the admin's own global default (already
            // correct on `column` via resolveLayout's spread of tableColumns)
            // — this user's resolved per-column visibility lives separately
            // in hiddenColumnKeys below. Writing it back into hidden_default
            // here would make an archived column (hidden_default: true)
            // silently read as "not archived" for any user who already had
            // that column visible in their own saved layout.
            resolved.map((column, index) => ({
              ...column,
              position: (index + 1) * 10,
            }))
          );
          setHiddenColumnKeys(
            new Set(
              resolved
                .filter((column) => column.hidden && !column.pinned)
                .map((column) => column.key as EnrollmentColumnKey)
            )
          );
        } else {
          setLayoutTableColumns(tableColumns);
        }
        enrollmentLayoutHydratedRef.current = true;
      })
      .catch(() => {
        if (!alive) return;
        setLayoutTableColumns(tableColumns);
        enrollmentLayoutHydratedRef.current = true;
      });

    return () => {
      alive = false;
      window.clearTimeout(resetTimer);
    };
  }, [program, setHiddenColumnKeys, tableColumns]);

  const saveEnrollmentLayout = useCallback(
    (layout: ReturnType<typeof serializeLayout>, signature: string) => {
      const sequence = ++enrollmentLayoutSaveSequenceRef.current;
      const saveProgram = program;
      const save = async () => {
        if (
          sequence !== enrollmentLayoutSaveSequenceRef.current ||
          saveProgram !== enrollmentLayoutProgramRef.current
        ) {
          return;
        }

        const response = await fetch("/api/config/layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: saveProgram,
            layout,
            expected_updated_at: enrollmentLayoutUpdatedAtRef.current,
          }),
        }).catch(() => null);
        if (response?.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { updated_at?: unknown }
            | null;
          if (
            saveProgram === enrollmentLayoutProgramRef.current &&
            typeof payload?.updated_at === "string"
          ) {
            enrollmentLayoutUpdatedAtRef.current = payload.updated_at;
          }
          if (saveProgram === enrollmentLayoutProgramRef.current) {
            enrollmentLayoutBaselineRef.current = signature;
          }
          return;
        }
        if (saveProgram !== enrollmentLayoutProgramRef.current) return;
        const data = (await response?.json().catch(() => null)) as
          | { error?: string }
          | null
          | undefined;
        setError(data?.error ?? "Could not save the table layout.");
      };

      const queued = enrollmentLayoutSaveQueueRef.current.then(save, save);
      enrollmentLayoutSaveQueueRef.current = queued.catch(() => undefined);
      void queued;
    },
    [program]
  );

  useEffect(() => {
    if (!enrollmentLayoutHydratedRef.current) return;
    const layout = serializeLayout(
      layoutTableColumns.map((column) => ({
        ...column,
        width: null,
        hidden:
          !column.pinned &&
          hiddenColumnKeys.has(column.key as EnrollmentColumnKey),
      }))
    );
    const signature = JSON.stringify(layout);
    if (enrollmentLayoutBaselineRef.current === null) {
      enrollmentLayoutBaselineRef.current = signature;
      return;
    }
    if (enrollmentLayoutBaselineRef.current === signature) return;
    const timer = window.setTimeout(() => {
      saveEnrollmentLayout(layout, signature);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hiddenColumnKeys, layoutTableColumns, program, saveEnrollmentLayout]);

  const peopleByEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of people) {
      map.set(person.email, person.name?.trim() || formatEmailAsName(person.email));
    }
    if (!map.has(currentEmail)) map.set(currentEmail, formatEmailAsName(currentEmail));
    return map;
  }, [currentEmail, people]);
  const agentsByEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      map.set(agent.email, agent.name?.trim() || formatEmailAsName(agent.email));
    }
    return map;
  }, [agents]);
  const ownedAgentEmails = useMemo(
    () => [...new Set([...myAgents, ...myAssistantAgents])],
    [myAgents, myAssistantAgents]
  );
  const createAgentsByEmail = useMemo(() => {
    if (canManageOptions) return agentsByEmail;
    const allowed = new Set(ownedAgentEmails.map(normalizeEnrollmentEmail));
    return new Map(
      [...agentsByEmail].filter(([email]) =>
        allowed.has(normalizeEnrollmentEmail(email))
      )
    );
  }, [agentsByEmail, canManageOptions, ownedAgentEmails]);
  const canCreateRecords =
    canManageOptions || myAgents.length > 0 || myAssistantAgents.length > 0;
  const mentionMembers = useMemo<TaskAssignee[]>(
    () =>
      people.map((person) => ({
        email: person.email,
        name: person.name,
      })),
    [people]
  );

  const rankedRecords = useMemo(
    () =>
      sortRecords(
        filterRecords(records, filters, optionsById, currentEmail),
        sort,
        optionsById,
        peopleByEmail
      ),
    [records, filters, optionsById, peopleByEmail, sort, currentEmail]
  );

  // Hold the order steady while the user works. sortRecords tiebreaks on
  // updated_at, which every patch bumps, so without this editing any field
  // reshuffled every row that ties on the sorted column. Reset only when the
  // user explicitly asks for a different slice or a different sort.
  const orderResetKey = useMemo(
    () => JSON.stringify([filters, sort, program]),
    [filters, sort, program]
  );
  // Set-during-render is React's documented way to adjust state when an input
  // changes: it re-renders before painting, and applyFrozenOrder is stable once
  // membership settles, so this converges in one extra pass.
  const [frozenIds, setFrozenIds] = useState<string[]>([]);
  const [frozenKey, setFrozenKey] = useState(orderResetKey);
  if (frozenKey !== orderResetKey) {
    setFrozenKey(orderResetKey);
    setFrozenIds([]);
  }
  const frozenRecords = applyFrozenOrder(
    rankedRecords,
    frozenKey === orderResetKey ? frozenIds : []
  );
  if (
    frozenRecords.nextFrozenIds.length !== frozenIds.length ||
    frozenRecords.nextFrozenIds.some((id, index) => id !== frozenIds[index])
  ) {
    setFrozenIds(frozenRecords.nextFrozenIds);
  }
  const visibleRecords = frozenRecords.rows;
  const exportColumnKeys = useMemo(
    () => {
      const keys = columns
        .filter(
          (column) =>
            column.locked || column.sticky || !hiddenColumnKeys.has(column.key)
        )
        .map((column) => column.key);
      // The FUB link is visibly embedded in Client Name, so keep exporting it
      // whenever the admin has not archived that system field.
      if (adminVisibleColumnKeys.has("fub")) keys.push("fub");
      return [...new Set(keys)].join(",");
    },
    [adminVisibleColumnKeys, columns, hiddenColumnKeys]
  );
  const exportRecordIds = useMemo(
    () => visibleRecords.map((record) => record.id),
    [visibleRecords]
  );
  const openRecord = records.find((record) => record.id === openId) ?? null;
  const overviewDateRange = overviewDateRanges[program];

  const exportVisibleRecords = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/enrollment/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program,
          columns: exportColumnKeys.split(",").filter(Boolean),
          ids: exportRecordIds,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Could not export enrollment data.");
        return;
      }
      await downloadResponseFile(response, `enrollment-${program}.xlsx`);
    } catch {
      setError("Could not export enrollment data.");
    }
  }, [exportColumnKeys, exportRecordIds, program]);

  const refetch = useCallback((): Promise<void> => {
    const current = recordsRefetchInFlightRef.current;
    if (current) {
      // Coalesce every trigger that arrives during a request into exactly one
      // trailing request. This prevents a realtime burst from creating a
      // queue of equally expensive full-list queries.
      recordsRefetchQueuedRef.current = true;
      return current;
    }

    const operation = (async () => {
      do {
        recordsRefetchQueuedRef.current = false;
        const seq = ++refetchSeqRef.current;
        // Captured BEFORE the request goes out: if a write is already in
        // flight, whatever the server returns cannot include it, so this
        // snapshot is stale-by-construction no matter what pendingRef looks
        // like later.
        const hadPendingAtIssue = pendingRef.current.size > 0;
        try {
          const response = await fetch(`/api/enrollment?program=${program}`, {
            cache: "no-store",
          });
          if (!response.ok) continue;
          const data = (await response.json()) as {
            records: EnrollmentRecordWithStats[];
          };
          // A newer sequence is not expected while single-flight is active,
          // but keep the guard for future callers and hot-reload races.
          if (seq !== refetchSeqRef.current) continue;
          if (hadPendingAtIssue || pendingRef.current.size > 0) {
            // Withheld, not discarded — this payload may carry other people's
            // changes. Re-run it once writes settle instead of allowing the
            // list to revert to a pre-write snapshot.
            if (pendingRef.current.size === 0) {
              refetchDirtyRef.current = false;
              recordsRefetchQueuedRef.current = true;
            } else {
              refetchDirtyRef.current = true;
            }
            continue;
          }
          refetchDirtyRef.current = false;
          updateRecords(() => data.records);
        } catch {
          // The next realtime ping or manual refresh will retry. If another
          // trigger arrived meanwhile, the trailing pass below will retry it.
        }
      } while (recordsRefetchQueuedRef.current);
    })().finally(() => {
      if (recordsRefetchInFlightRef.current === operation) {
        recordsRefetchInFlightRef.current = null;
      }
    });

    recordsRefetchInFlightRef.current = operation;
    return operation;
  }, [program]);

  // Re-run an update that was dropped because a write was in flight, so we
  // never trade "UI reverts" for "UI silently stale".
  const flushDeferredRefetch = useCallback(() => {
    if (pendingRef.current.size > 0) return;
    if (!refetchDirtyRef.current) return;
    refetchDirtyRef.current = false;
    void refetch();
  }, [refetch]);

  const reloadOptions = useCallback(async () => {
    const sequence = ++optionsRequestSequenceRef.current;
    const response = await fetch(
      `/api/enrollment/option-sets?program=${program}`,
      { cache: "no-store" }
    );
    if (!response.ok) return;
    const data = (await response.json()) as { options: EnrollmentOption[] };
    if (sequence !== optionsRequestSequenceRef.current) return;
    setOptions(data.options);
  }, [program]);

  // Auto-dismiss now lives in <Toast>; keeping a second timer here would be
  // duplicated logic that can drift out of sync with it.

  useEffect(() => {
    const initialRecordTimer = window.setTimeout(() => {
      const params = new URL(window.location.href).searchParams;
      setOpenId(params.get("record"));
      setOpenCommentId(params.get("comment"));
    }, 0);

    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ recordId?: unknown; commentId?: unknown }>).detail;
      if (typeof detail?.recordId !== "string") return;
      setOpenId(detail.recordId);
      const commentId =
        typeof detail.commentId === "string" && detail.commentId.length > 0
          ? detail.commentId
          : null;
      setOpenCommentId(commentId);
      writeEnrollmentDeepLink(detail.recordId, "push", commentId);
    };
    window.addEventListener(OPEN_ENROLLMENT_EVENT, onOpen);
    return () => {
      window.clearTimeout(initialRecordTimer);
      window.removeEventListener(OPEN_ENROLLMENT_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    const onHistoryNavigation = () => {
      const params = new URL(window.location.href).searchParams;
      setOpenId(params.get("record"));
      setOpenCommentId(params.get("comment"));
    };
    window.addEventListener("popstate", onHistoryNavigation);
    return () => window.removeEventListener("popstate", onHistoryNavigation);
  }, []);

  useEffect(() => {
    const sb = getBrowserSupabase();
    if (!sb) {
      const degradedTimer = window.setTimeout(() => setLiveStatus("degraded"), 0);
      return () => window.clearTimeout(degradedTimer);
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    const schedule = (scope: "enrollments-only" | "full") => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!active) return;
        void refetch();
        if (scope === "full") void reloadOptions();
      }, ENROLLMENT_LIVE_EVENT_DEBOUNCE_MS);
    };
    const channel = sb
      .channel(enrollmentTopic(program))
      .on(
        "broadcast",
        { event: "changed" },
        (message: { payload?: Record<string, unknown> }) => {
          if (!active) return;
          const sourceId =
            typeof message.payload?.sourceId === "string"
              ? message.payload.sourceId
              : undefined;
          const scope = enrollmentBroadcastReconcileScope(
            sourceId,
            liveSourceId,
          );
          if (scope) schedule(scope);
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setLiveStatus("live");
          schedule("full");
          return;
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setLiveStatus("degraded");
        }
      });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [liveSourceId, program, refetch, reloadOptions]);

  useEffect(() => {
    const unsubscribe = subscribeEnrollmentDataInvalidation((invalidation) => {
      const scope = enrollmentInvalidationReconcileScope(
        invalidation,
        liveSourceId,
      );
      if (!scope) return;
      void refetch();
      if (scope === "full") void reloadOptions();
    });
    return unsubscribe;
  }, [liveSourceId, refetch, reloadOptions]);

  useEffect(() => {
    const refreshFromForeground = () => {
      if (!canRefreshEnrollmentData(document.visibilityState, navigator.onLine)) {
        return;
      }
      const now = Date.now();
      if (
        now - lastForegroundRefreshAtRef.current <
        ENROLLMENT_LIVE_REFRESH_THROTTLE_MS
      ) {
        return;
      }
      lastForegroundRefreshAtRef.current = now;
      getBrowserSupabase()?.realtime.connect();
      void refetch();
      void reloadOptions();
    };
    const onOffline = () => setLiveStatus("degraded");
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", refreshFromForeground);
    window.addEventListener("online", refreshFromForeground);
    document.addEventListener("visibilitychange", refreshFromForeground);
    return () => {
      window.removeEventListener("focus", refreshFromForeground);
      window.removeEventListener("online", refreshFromForeground);
      document.removeEventListener("visibilitychange", refreshFromForeground);
      window.removeEventListener("offline", onOffline);
    };
  }, [refetch, reloadOptions]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (canRefreshEnrollmentData(document.visibilityState, navigator.onLine)) {
        void refetch();
        void reloadOptions();
      }
    }, enrollmentLivePollInterval(liveStatus));
    return () => window.clearInterval(timer);
  }, [liveStatus, refetch, reloadOptions]);

  useEffect(() => {
    const sb = getBrowserSupabase();
    if (!sb) return;
    const channel = sb
      .channel(TABLE_CONFIG_TOPIC)
      .on("broadcast", { event: "changed" }, () => setConfigStale(true))
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, []);

  async function fetchCanonicalRecord(id: string): Promise<EnrollmentRecordWithStats | null> {
    try {
      const response = await fetch(`/api/enrollment/${id}`, { cache: "no-store" });
      if (!response.ok) return null;
      const data = (await response.json()) as { record?: EnrollmentRecordWithStats };
      return data.record?.id === id ? data.record : null;
    } catch {
      return null;
    }
  }

  function rebasePendingEnrollmentPatches(id: string, state: EnrollmentMutationState) {
    let next = state.confirmed;
    for (const pending of state.pending) {
      const optimisticPatch = isPlainRecord(pending.columnPatch.custom_values)
        ? {
            ...pending.columnPatch,
            custom_values: {
              ...(isPlainRecord(next.custom_values) ? next.custom_values : {}),
              ...pending.columnPatch.custom_values,
            },
          }
        : pending.columnPatch;
      next = { ...next, ...optimisticPatch } as EnrollmentRecordWithStats;
    }
    recordRowsRef.current.set(id, next);
    updateRecords((current) =>
      current.map((record) => (record.id === id ? next : record))
    );
    if (state.pending.length === 0) {
      recordMutationStatesRef.current.delete(id);
    }
  }

  function patchRecord(id: string, patch: Record<string, unknown>): Promise<void> {
    const before = recordRowsRef.current.get(id) ?? records.find((record) => record.id === id);
    if (!before) return Promise.resolve();

    const state =
      recordMutationStatesRef.current.get(id) ??
      ({
        confirmed: before,
        pending: [],
        nextSequence: 0,
        tail: Promise.resolve(),
      } satisfies EnrollmentMutationState);
    recordMutationStatesRef.current.set(id, state);
    const sequence = state.nextSequence++;
    writeVersionRef.current += 1;

    // Translate request-only keys into the columns the row actually renders.
    // Without this the QC toggle wrote `qc_checked`, which nothing reads, and
    // left `qc_checked_at` -- which every surface reads -- unchanged until the
    // server replied. Computed once and stored so rebases replay the same value.
    const columnPatch = toOptimisticEnrollmentPatch(
      patch,
      currentEmail,
      new Date().toISOString()
    );
    state.pending.push({ sequence, patch, columnPatch });

    const optimisticPatch = isPlainRecord(columnPatch.custom_values)
      ? {
          ...columnPatch,
          custom_values: {
            ...(isPlainRecord(before.custom_values) ? before.custom_values : {}),
            ...columnPatch.custom_values,
          },
        }
      : columnPatch;
    const optimistic = { ...before, ...optimisticPatch } as EnrollmentRecordWithStats;
    recordRowsRef.current.set(id, optimistic);
    updateRecords((current) =>
      current.map((record) => (record.id === id ? optimistic : record))
    );
    const finishPendingMutation = beginPending(id);

    const operation = state.tail
      .then(async () => {
        let response: Response;
        try {
          response = await fetch(`/api/enrollment/${id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "x-enrollment-client-source": liveSourceId,
            },
            body: JSON.stringify({ ...patch, expected_updated_at: state.confirmed.updated_at }),
          });
        } catch {
          setError("Connection lost — could not update enrollment record.");
          return;
        }

        const data = (await response.json().catch(() => null)) as
          | { record?: EnrollmentRecordWithStats; error?: string }
          | null;
        if (!response.ok || !data?.record) {
          if (response.status === 409) {
            const canonical = await fetchCanonicalRecord(id);
            if (canonical) {
              state.confirmed = canonical;
              setError("Enrollment record changed elsewhere; canonical data was reloaded.");
            } else {
              setError("Enrollment record changed elsewhere; refresh before editing again.");
            }
          } else {
            setError(data?.error ?? "Could not update enrollment record.");
          }
          return;
        }
        state.confirmed = data.record;
        publishEnrollmentDataInvalidation({
          recordId: id,
          sourceId: liveSourceId,
        });
      })
      .catch(() => {
        setError("Could not update enrollment record.");
      })
      .finally(() => {
        state.pending = state.pending.filter((pending) => pending.sequence !== sequence);
        rebasePendingEnrollmentPatches(id, state);
        finishPendingMutation();
      });

    state.tail = operation;
    return operation;
  }

  async function uploadEnrollmentFiles(
    recordId: string,
    files: readonly PendingFile[],
  ): Promise<string[]> {
    const results = await Promise.all(
      files.map(async (pending) => {
        try {
          const form = new FormData();
          form.append("file", pending.file);
          form.append("client_request_id", crypto.randomUUID());
          const response = await fetch(`/api/enrollment/${recordId}/attachments`, {
            method: "POST",
            headers: { "x-enrollment-client-source": liveSourceId },
            body: form,
          });
          return { name: pending.name, ok: response.ok };
        } catch {
          return { name: pending.name, ok: false };
        }
      }),
    );
    return results.filter((result) => !result.ok).map((result) => result.name);
  }

  async function createRecord(
    payload: Record<string, unknown>,
    pendingFiles: readonly PendingFile[] = [],
  ) {
    // Registered in pendingRef like any other write: without it a refetch
    // that raced this POST is treated as clean and applied, and the record
    // the user just created disappears from the list until the next ping.
    // The id isn't known yet, so use a placeholder key — pendingRef is only
    // ever checked for emptiness.
    const pendingKey = `create:${Date.now()}`;
    writeVersionRef.current += 1;
    const finishPendingMutation = beginPending(pendingKey);
    try {
      const response = await fetch("/api/enrollment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-enrollment-client-source": liveSourceId,
        },
        body: JSON.stringify({ ...payload, program }),
      });
      const data = (await response.json().catch(() => null)) as
        | { record?: EnrollmentRecordWithStats; error?: string }
        | null;
      if (!response.ok || !data?.record) {
        throw new Error(data?.error ?? "Could not create enrollment record.");
      }
      updateRecords((current) => [data.record!, ...current]);
      publishEnrollmentDataInvalidation({ sourceId: liveSourceId });
      if (pendingFiles.length > 0) {
        const failedFiles = await uploadEnrollmentFiles(data.record.id, pendingFiles);
        if (failedFiles.length > 0) {
          setError(
            `Enrollment was created, but these files did not upload: ${failedFiles.join(", ")}.`,
          );
        }
        publishEnrollmentDataInvalidation({
          recordId: data.record.id,
          sourceId: liveSourceId,
        });
      }
    } finally {
      finishPendingMutation();
    }
  }

  async function archiveRecord(id: string) {
    const before = recordRowsRef.current.get(id) ?? records.find((record) => record.id === id);
    if (!before) return;
    const beforeIndex = records.findIndex((record) => record.id === id);
    writeVersionRef.current += 1;
    // Same reason as createRecord: an unguarded refetch would resurrect the
    // row we just removed.
    const finishPendingMutation = beginPending(id);
    updateRecords((current) => current.filter((record) => record.id !== id));
    setOpenId(null);
    setOpenCommentId(null);
    writeEnrollmentDeepLink(null);
    try {
      const response = await fetch(`/api/enrollment/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-enrollment-client-source": liveSourceId,
        },
        body: JSON.stringify({ expected_updated_at: before.updated_at }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          record?: EnrollmentRecordWithStats;
        } | null;
        updateRecords((current) => {
          if (current.some((record) => record.id === id)) return current;
          const restored = [...current];
          const restoredRecord = data?.record?.id === id ? data.record : before;
          restored.splice(
            Math.min(Math.max(beforeIndex, 0), restored.length),
            0,
            restoredRecord,
          );
          return restored;
        });
        setError(
          response.status === 409
            ? "Enrollment record changed elsewhere; it was restored with canonical data."
            : data?.error ?? "Could not archive record.",
        );
      }
      else {
        publishEnrollmentDataInvalidation({
          recordId: id,
          sourceId: liveSourceId,
        });
      }
    } catch {
      updateRecords((current) => {
        if (current.some((record) => record.id === id)) return current;
        const restored = [...current];
        restored.splice(Math.min(Math.max(beforeIndex, 0), restored.length), 0, before);
        return restored;
      });
      setError("Connection lost — could not archive record.");
    } finally {
      finishPendingMutation();
    }
  }

  function applyParentUpdatedAt(id: string, updatedAt: string) {
    const current = recordRowsRef.current.get(id);
    if (current && Date.parse(updatedAt) > Date.parse(current.updated_at)) {
      updateRecords((rows) =>
        rows.map((record) =>
          record.id === id ? { ...record, updated_at: updatedAt } : record,
        ),
      );
    }
    const state = recordMutationStatesRef.current.get(id);
    if (
      state &&
      Date.parse(updatedAt) > Date.parse(state.confirmed.updated_at)
    ) {
      state.confirmed = { ...state.confirmed, updated_at: updatedAt };
    }
  }

  function openRecordById(id: string) {
    prefetchEnrollmentDetail(id);
    setOpenId(id);
    setOpenCommentId(null);
    writeEnrollmentDeepLink(id, "push");
  }

  function closeRecord() {
    setOpenId(null);
    setOpenCommentId(null);
    writeEnrollmentDeepLink(null);
  }

  const shellClassName =
    "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7f9fc] text-[#172b4d]";

  return (
    <div className={shellClassName}>
      {configStale ? (
        <div className="flex items-center justify-between gap-3 border-b border-[#ffab00] bg-[#fff7d6] px-6 py-2 text-sm font-semibold text-[#7f5f00]" role="alert">
          <span>Table configuration changed. Reload before editing enrollments.</span>
          <button type="button" className="rounded bg-[#ffab00] px-3 py-1 text-xs font-bold text-[#172b4d]" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : null}
      {liveStatus === "degraded" ? (
        <div
          className="flex items-center justify-between gap-3 border-b border-[#ffab00] bg-[#fff7d6] px-6 py-2 text-sm font-semibold text-[#7f5f00]"
          role="status"
        >
          <span>Live updates are reconnecting. Data will keep refreshing automatically.</span>
          <button
            type="button"
            className="rounded bg-[#ffab00] px-3 py-1 text-xs font-bold text-[#172b4d]"
            onClick={() => {
              getBrowserSupabase()?.realtime.connect();
              void refetch();
              void reloadOptions();
            }}
          >
            Refresh now
          </button>
        </div>
      ) : null}
      <div className="min-w-0 shrink-0 px-6 pb-4 pt-5">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold leading-tight tracking-normal text-[#172b4d]">
                {ENROLLMENT_PROGRAM_LABELS[program]}
              </h1>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canExport ? (
                <EnrollmentExportMenu onExport={exportVisibleRecords} />
              ) : null}
              {canCreateRecords ? (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0c66e4] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc]"
                >
                  <Plus className="h-4 w-4" />
                  New enrollment
                </button>
              ) : null}
            </div>
          </header>

          <EnrollmentToolbar
            program={program}
            view={visibleView}
            canViewOverview={canManageOptions}
            onViewChange={setView}
            filters={filters}
            setFilters={setFilters}
            people={people}
            agents={agents}
            optionsBySet={optionsBySet}
            columns={columns}
            hiddenColumnKeys={hiddenColumnKeys}
            onToggleColumn={toggleColumn}
            overviewDateRange={overviewDateRange}
            onOverviewDateRangeChange={(range) =>
              setOverviewDateRanges((current) => ({ ...current, [program]: range }))
            }
            visibleCount={visibleRecords.length}
            totalCount={records.length}
          />
        </div>
      </div>

      {visibleView === "overview" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-6">
          <div className="mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 flex-col">
            <EnrollmentOverview
              key={`${program}|${overviewDateRange.from}|${overviewDateRange.to}`}
              program={program}
              from={overviewDateRange.from}
              to={overviewDateRange.to}
              isManager={canManageOptions}
              onOpenRecord={openRecordById}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex flex-1 flex-col px-6 pb-6">
          <div className="mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 flex-col">
            <EnrollmentTable
              columns={visibleColumns}
              records={visibleRecords}
              peopleByEmail={peopleByEmail}
              agentsByEmail={agentsByEmail}
              optionsById={optionsById}
              optionsBySet={optionsBySet}
              tableColumnOptions={tableColumnOptions}
              currentEmail={currentEmail}
              isManager={canManageOptions}
              agentScopeEmails={ownedAgentEmails}
              sort={sort}
              onSort={(key) =>
                setSort((current) =>
                  current.key === key
                    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
                    : { key, dir: "asc" }
                )
              }
              onOpen={openRecordById}
              onPatch={patchRecord}
            />
          </div>
        </div>
      )}

      <Toast message={error} tone="error" onDismiss={() => setError(null)} />

      {openRecord ? (
        <EnrollmentDrawer
          key={openRecord.id}
          record={openRecord}
          peopleByEmail={peopleByEmail}
          agentsByEmail={agentsByEmail}
          mentionMembers={mentionMembers}
          optionsById={optionsById}
          optionsBySet={optionsBySet}
          detailColumns={detailCustomColumns}
          visibleColumnKeys={adminVisibleColumnKeys}
          requiredColumnKeys={requiredColumnKeys}
          columnByKey={columnByKey}
          tableColumnOptions={tableColumnOptions}
          currentEmail={currentEmail}
          mutationSourceId={liveSourceId}
          highlightCommentId={openCommentId}
          isManager={canManageOptions}
          agentScopeEmails={ownedAgentEmails}
          onClose={closeRecord}
          onPatch={(patch) => patchRecord(openRecord.id, patch)}
          onArchive={() => archiveRecord(openRecord.id)}
          onParentUpdatedAt={(updatedAt) =>
            applyParentUpdatedAt(openRecord.id, updatedAt)
          }
          onParentRefresh={() => refetch()}
        />
      ) : null}

      {creating && canCreateRecords ? (
        <NewEnrollmentDialog
          program={program}
          peopleByEmail={peopleByEmail}
          agentsByEmail={createAgentsByEmail}
          optionsBySet={optionsBySet}
          visibleColumnKeys={adminVisibleColumnKeys}
          requiredColumnKeys={requiredColumnKeys}
          columnByKey={columnByKey}
          customColumns={createCustomColumns}
          tableColumnOptions={tableColumnOptions}
          currentEmail={currentEmail}
          onClose={() => setCreating(false)}
          onCreate={async (payload, pendingFiles) => {
            await createRecord(payload, pendingFiles);
            setCreating(false);
          }}
        />
      ) : null}

    </div>
  );
}

function EnrollmentExportMenu({ onExport }: { onExport: () => void }) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4] ${
          isOpen ? "border-[#0c66e4] text-[#0c66e4]" : "border-[#d8dee8]"
        }`}
      >
        <Download className="h-4 w-4" />
        Export
        <ChevronDown className="h-4 w-4 text-[#6b778c]" />
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              role="menu"
              className="dashboard-filter-menu z-[140] w-[min(17rem,calc(100vw-1rem))] overflow-hidden p-1.5"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  onExport();
                }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-[#172b4d] transition hover:bg-[#f4f5f7]"
              >
                <Download className="h-4 w-4 text-[#0c66e4]" />
                Export visible data
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function getDownloadFilename(contentDisposition: string | null, fallback: string) {
  const match = contentDisposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
}

async function downloadResponseFile(response: Response, fallback: string) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getDownloadFilename(
    response.headers.get("content-disposition"),
    fallback
  );
  link.click();
  URL.revokeObjectURL(url);
}

function EnrollmentToolbar({
  program,
  view,
  canViewOverview,
  onViewChange,
  filters,
  setFilters,
  people,
  agents,
  optionsBySet,
  columns,
  hiddenColumnKeys,
  onToggleColumn,
  overviewDateRange,
  onOverviewDateRangeChange,
  visibleCount,
  totalCount,
}: {
  program: EnrollmentProgram;
  view: "list" | "overview";
  canViewOverview: boolean;
  onViewChange: (view: "list" | "overview") => void;
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  people: EnrollmentPerson[];
  agents: TaskAgent[];
  optionsBySet: EnrollmentOptionsBySet;
  columns: EnrollmentColumn[];
  hiddenColumnKeys: Set<EnrollmentColumnKey>;
  onToggleColumn: (key: EnrollmentColumnKey) => void;
  overviewDateRange: TaskDateRangeValue;
  onOverviewDateRangeChange: (value: TaskDateRangeValue) => void;
  visibleCount: number;
  totalCount: number;
}) {
  const isMedicare = program === "medicare";
  // Label source for the filter dropdowns below — built from the already
  // resolved `columns` prop, not a second independent derivation.
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const hasActiveFilters =
    filters.query.trim() !== "" ||
    filters.stage.length > 0 ||
    filters.agent.length > 0 ||
    filters.caller.length > 0 ||
    filters.responsible.length > 0 ||
    filters.carrier.length > 0 ||
    filters.attention ||
    filters.qcNeeded ||
    filters.unowned ||
    filters.createdFrom !== "" ||
    filters.createdTo !== "";

  return (
    <section className="mt-2 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="inline-flex shrink-0 rounded bg-[#f4f5f7] p-0.5">
            {([
              ...(canViewOverview ? (["overview"] as const) : []),
              "list",
            ] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onViewChange(key)}
                aria-current={view === key ? "page" : undefined}
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  view === key ? "bg-white text-[#0c66e4] shadow-sm" : "text-[#5e6c84] hover:text-[#172b4d]"
                }`}
              >
                {key === "list" ? "List" : "Overview"}
              </button>
            ))}
          </div>

          {view === "list" ? (
            <div className="relative min-w-[18rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
              <input
                value={filters.query}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, query: event.target.value }))
                }
                placeholder="Search client, FUB, and comments..."
                className="h-10 w-full rounded border-2 border-transparent bg-[#f4f5f7] pl-10 pr-9 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#44546f] hover:bg-[#ebecf0] focus:border-[#0c66e4] focus:bg-white"
              />
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <DateRangeFilter
            from={view === "overview" ? overviewDateRange.from : filters.createdFrom}
            to={view === "overview" ? overviewDateRange.to : filters.createdTo}
            allDatesLabel={view === "overview" ? "All dates" : "All created dates"}
            onChange={({ from, to }) => {
              if (view === "overview") {
                onOverviewDateRangeChange({ from, to });
              } else {
                setFilters((current) => ({ ...current, createdFrom: from, createdTo: to }));
              }
            }}
          />
        </div>
      </div>

      {view === "list" ? (
      <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
        <TaskSelect
          label={columnByKey.get("stage")?.label ?? "Stage"}
          multi
          searchable
          values={filters.stage}
          options={[
            { value: "", label: columnByKey.get("stage")?.label ?? "Stage" },
            ...selectOptions(optionsBySet.stage),
          ]}
          placeholder={columnByKey.get("stage")?.label ?? "Stage"}
          allValue=""
          summaryLabel="stages"
          className="w-max min-w-[8.75rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onValuesChange={(stage) => setFilters((current) => ({ ...current, stage }))}
        />

        <TaskSelect
          label={columnByKey.get("agent")?.label ?? "Agent"}
          multi
          searchable
          values={filters.agent}
          options={[{ value: "", label: "All Agents" }, ...agentOptions(agents)]}
          placeholder={columnByKey.get("agent")?.label ?? "Agent"}
          allValue=""
          summaryLabel="agents"
          className="w-max min-w-[10rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onValuesChange={(agent) => setFilters((current) => ({ ...current, agent }))}
        />

        {!isMedicare ? (
          <TaskSelect
            label={columnByKey.get("caller")?.label ?? "Caller"}
            multi
            searchable
            values={filters.caller}
            options={[{ value: "", label: "All Callers" }, ...peopleOptions(people)]}
            placeholder={columnByKey.get("caller")?.label ?? "Caller"}
            allValue=""
            summaryLabel="callers"
            className="w-max min-w-[10rem]"
            buttonClassName={FILTER_SELECT_BUTTON_CLASS}
            onValuesChange={(caller) =>
              setFilters((current) => ({ ...current, caller }))
            }
          />
        ) : null}

        <TaskSelect
          label={
            columnByKey.get("responsible")?.label ?? (isMedicare ? "Assignee" : "Responsible")
          }
          multi
          searchable
          values={filters.responsible}
          options={[
            { value: "", label: isMedicare ? "All Assignees" : "All Responsible" },
            ...peopleOptions(people),
          ]}
          placeholder={
            columnByKey.get("responsible")?.label ?? (isMedicare ? "Assignee" : "Responsible")
          }
          allValue=""
          summaryLabel="people"
          className="w-max min-w-[11rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onValuesChange={(responsible) =>
            setFilters((current) => ({ ...current, responsible, mineOnly: false }))
          }
        />

        <TaskSelect
          label={columnByKey.get("carrier")?.label ?? "Carrier"}
          multi
          searchable
          values={filters.carrier}
          options={[
            { value: "", label: columnByKey.get("carrier")?.label ?? "Carrier" },
            ...selectOptions(optionsBySet.carrier),
          ]}
          placeholder={columnByKey.get("carrier")?.label ?? "Carrier"}
          allValue=""
          summaryLabel="carriers"
          className="w-max min-w-[10rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onValuesChange={(carrier) =>
            setFilters((current) => ({ ...current, carrier }))
          }
        />

        <ColumnVisibilityButton
          columns={columns}
          hiddenColumnKeys={hiddenColumnKeys}
          onToggleColumn={onToggleColumn}
        />

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="h-9 shrink-0 px-1 text-sm font-medium text-[#0c66e4] transition hover:underline"
          >
            Clear all
          </button>
        ) : null}

        <span className="ml-auto shrink-0 text-sm font-medium text-[#626f86]">
          {visibleCount} of {totalCount} records
        </span>
      </div>
      ) : null}

    </section>
  );
}

function ColumnVisibilityButton({
  columns,
  hiddenColumnKeys,
  onToggleColumn,
}: {
  columns: EnrollmentColumn[];
  hiddenColumnKeys: Set<EnrollmentColumnKey>;
  onToggleColumn: (key: EnrollmentColumnKey) => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle } = useAnchoredMenu();
  const toggleableColumns = columns.filter((column) => !column.sticky && !column.locked);
  const hiddenCount = toggleableColumns.filter((column) =>
    hiddenColumnKeys.has(column.key)
  ).length;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        title="Table settings"
        aria-label={
          hiddenCount > 0
            ? `Table settings, ${hiddenCount} hidden columns`
            : "Table settings"
        }
        aria-expanded={isOpen}
        className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-white text-[#44546f] shadow-[0_1px_3px_rgba(22,35,58,0.12)] transition hover:border-[#b8c5d6] hover:bg-[#f8fafc] hover:text-[#172b4d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#deebff] ${
          isOpen ? "border-[#0c66e4] text-[#0c66e4]" : "border-[#dfe1e6]"
        }`}
      >
        <Settings2 className="h-[18px] w-[18px]" />
        {hiddenCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#deebff] px-1 text-[10px] font-bold leading-none text-[#0c66e4] ring-2 ring-white">
            {hiddenCount}
          </span>
        ) : null}
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="dashboard-filter-menu z-[110] flex w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden p-2"
            >
              <div className="border-b border-[#ebecf0] px-2 py-2">
                <div className="flex items-center gap-2 text-sm font-bold text-[#172b4d]">
                  <Settings2 className="h-4 w-4 text-[#0c66e4]" />
                  Table settings
                </div>
                <div className="mt-1 text-[11px] font-medium text-[#6b778c]">
                  Choose which table columns are visible.
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto py-1">
                {toggleableColumns.map((column) => {
                  const checked = !hiddenColumnKeys.has(column.key);
                  return (
                    <label
                      key={column.key}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-semibold text-[#172b4d] transition hover:bg-[#f4f5f7]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleColumn(column.key)}
                        className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]"
                      />
                      <span className="min-w-0 truncate">{column.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function EnrollmentTable({
  columns,
  records,
  peopleByEmail,
  agentsByEmail,
  optionsById,
  optionsBySet,
  tableColumnOptions,
  currentEmail,
  isManager,
  agentScopeEmails,
  sort,
  onSort,
  onOpen,
  onPatch,
}: {
  columns: EnrollmentColumn[];
  records: EnrollmentRecordWithStats[];
  peopleByEmail: Map<string, string>;
  agentsByEmail: Map<string, string>;
  optionsById: Map<string, EnrollmentOption>;
  optionsBySet: EnrollmentOptionsBySet;
  tableColumnOptions: TableColumnOption[];
  currentEmail: string;
  isManager: boolean;
  agentScopeEmails: readonly string[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const minWidth = useMemo(
    () => columns.reduce((sum, column) => sum + column.width, 0),
    [columns]
  );
  const tableFrameStyle: CSSProperties = {
    maxHeight: "1008px",
  };

  if (records.length === 0) {
    return (
      <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
        No enrollment records match this view.
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]"
      style={tableFrameStyle}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth }}>
          <div className="sticky top-0 z-20 flex items-stretch whitespace-nowrap border-b border-[#dfe1e6] bg-[#fafbfc] text-[11px] font-bold uppercase tracking-wide text-[#6b778c] shadow-[0_1px_0_#dfe1e6]">
            {columns.map((column) => (
              <div
                key={column.key}
                style={{
                  width: column.width,
                  left: column.sticky ? stickyOffset(columns, column.key) : undefined,
                }}
                className={`flex shrink-0 items-center px-3 py-2 ${
                  column.align === "center" ? "justify-center" : ""
                } ${column.sticky ? "sticky z-[30] border-r border-[#dfe1e6] bg-[#fafbfc]" : ""}`}
              >
                {column.sortable ? (
                  <EnrollmentSortTh
                    label={column.label}
                    col={column.key as SortKey}
                    sortKey={sort.key}
                    sortDir={sort.dir}
                    onSort={onSort}
                  />
                ) : (
                  <span className="truncate">{column.label}</span>
                )}
              </div>
            ))}
          </div>
          <ul>
            {records.map((record) => (
              <li key={record.id} className="border-b border-[#ebecf0]">
                <EnrollmentRowItem
                  columns={columns}
                  record={record}
                  peopleByEmail={peopleByEmail}
                  agentsByEmail={agentsByEmail}
                  optionsById={optionsById}
                  optionsBySet={optionsBySet}
                  tableColumnOptions={tableColumnOptions}
                  currentEmail={currentEmail}
                  isManager={isManager}
                  agentScopeEmails={agentScopeEmails}
                  onOpen={onOpen}
                  onPatch={onPatch}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function EnrollmentRowItem({
  columns,
  record,
  peopleByEmail,
  agentsByEmail,
  optionsById,
  optionsBySet,
  tableColumnOptions,
  currentEmail,
  isManager,
  agentScopeEmails,
  onOpen,
  onPatch,
}: {
  columns: EnrollmentColumn[];
  record: EnrollmentRecordWithStats;
  peopleByEmail: Map<string, string>;
  agentsByEmail: Map<string, string>;
  optionsById: Map<string, EnrollmentOption>;
  optionsBySet: EnrollmentOptionsBySet;
  tableColumnOptions: TableColumnOption[];
  currentEmail: string;
  isManager: boolean;
  agentScopeEmails: readonly string[];
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
  const has = (key: EnrollmentColumn["key"]) => columns.some((column) => column.key === key);
  const customColumns = columns.filter(
    (column) => column.configColumn && !column.configColumn.is_system
  );
  const customOptionLabelById = new Map(
    tableColumnOptions.map((option) => [option.id, option.label])
  );
  const customOptionsByColumnId = new Map<string, TableColumnOption[]>();
  for (const option of tableColumnOptions) {
    const list = customOptionsByColumnId.get(option.column_id) ?? [];
    list.push(option);
    customOptionsByColumnId.set(option.column_id, list);
  }
  const customPeople = [...peopleByEmail.entries()].map(([email, name]) => ({
    email,
    name,
  }));
  const capabilities = resolveEnrollmentRecordCapabilitiesClient(
    record,
    currentEmail,
    isManager,
    agentScopeEmails
  );

  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const columnOrderByKey = new Map(
    columns.map((column, index) => [column.key, index])
  );

  function cellStyleFor(key: EnrollmentColumn["key"]): CSSProperties {
    const column = columnByKey.get(key);
    return {
      width: column?.width ?? colWidth(columns, key),
      order: columnOrderByKey.get(key) ?? 999,
      left: column?.sticky ? stickyOffset(columns, key) : undefined,
    };
  }

  function cellClassName(key: EnrollmentColumn["key"], className: string): string {
    const stickyClass = columnByKey.get(key)?.sticky
      ? "sticky z-[1] border-r border-[#dfe1e6] bg-white group-hover:bg-[#f7f8f9]"
      : "";
    return `${className} ${stickyClass}`;
  }

  return (
    <div
      onMouseEnter={() => prefetchEnrollmentDetail(record.id)}
      onDoubleClick={() => onOpen(record.id)}
      className="group flex min-h-11 items-stretch whitespace-nowrap bg-white transition hover:bg-[#f7f8f9]"
    >
      {has("key") ? (
        <div
          style={cellStyleFor("key")}
          className={cellClassName(
            "key",
            "flex shrink-0 items-center px-3 py-2.5"
          )}
        >
          <span
            className="truncate font-mono text-xs font-bold text-[#97a0af]"
            title={enrollmentDisplayKey(record.display_number, record.program)}
          >
            {enrollmentDisplayKey(record.display_number, record.program)}
          </span>
        </div>
      ) : null}

      {has("client") ? (
        <div
          style={cellStyleFor("client")}
          className={cellClassName(
            "client",
            "flex shrink-0 items-center px-3 py-2.5"
          )}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(record.id);
            }}
            className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-sm font-medium text-[#172b4d] transition hover:bg-[#f4f5f7] hover:text-[#0c66e4]"
            title={record.client_name || "Unnamed client"}
          >
            <span className="block truncate">{record.client_name || "Unnamed client"}</span>
          </button>
          {record.fub_link ? (
            <a
              href={formatExternalLink(record.fub_link)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#b3d4ff] bg-[#deebff] text-[#0055cc] transition hover:bg-[#cce0ff]"
              title="Open FUB"
              aria-label="Open FUB"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Stage */}
      {has("stage") ? (
        <div
          style={cellStyleFor("stage")}
          className={cellClassName("stage", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EnrollmentStagePill
            stageId={record.stage_id}
            stages={optionsBySet.stage}
            canEdit={capabilities.canChangeStage}
            onChange={(value) => onPatch(record.id, { stage_id: value })}
          />
        </div>
      ) : null}

      {has("agent") ? (
        <div
          style={cellStyleFor("agent")}
          className={cellClassName("agent", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EnrollmentPersonMenu
            value={record.agent_email}
            peopleByEmail={agentsByEmail}
            emptyLabel="No agent"
            surface="list"
            canEdit={capabilities.canTransferAgent}
            onChange={(value) => void onPatch(record.id, { agent_email: value })}
          />
        </div>
      ) : null}

      {/* Caller — ACA only; Medicare has a single Assignee (Responsible). */}
      {has("caller") ? (
        <div
          style={cellStyleFor("caller")}
          className={cellClassName("caller", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EnrollmentPersonMenu
            value={record.caller_email}
            peopleByEmail={peopleByEmail}
            emptyLabel="No caller"
            surface="list"
            canEdit={capabilities.canAssignPeople}
            onChange={(value) => void onPatch(record.id, { caller_email: value })}
          />
        </div>
      ) : null}

      {/* Responsible Enroll (labeled "Assignee" for Medicare) */}
      {has("responsible") ? (
        <div
          style={cellStyleFor("responsible")}
          className={cellClassName("responsible", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EnrollmentPersonMenu
            value={record.responsible_enroll_email}
            peopleByEmail={peopleByEmail}
            emptyLabel="Unassigned"
            surface="list"
            canEdit={capabilities.canAssignPeople}
            onChange={(value) =>
              void onPatch(record.id, { responsible_enroll_email: value })
            }
          />
        </div>
      ) : null}

      {/* Payment status — ACA only */}
      {has("payment") ? (
        <div
          style={cellStyleFor("payment")}
          className={cellClassName("payment", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EnrollmentOptionMenu
            optionId={record.payment_status_id}
            options={optionsBySet.payment_status}
            emptyLabel="No payment"
            surface="list"
            canEdit={capabilities.canEditFields}
            onChange={(value) => void onPatch(record.id, { payment_status_id: value })}
          />
        </div>
      ) : null}

      {/* Carrier */}
      {has("carrier") ? (
        <div
          style={cellStyleFor("carrier")}
          className={cellClassName("carrier", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EnrollmentOptionMenu
            optionId={record.carrier_id}
            options={optionsBySet.carrier}
            emptyLabel="No carrier"
            surface="list"
            canEdit={capabilities.canEditFields}
            onChange={(value) => void onPatch(record.id, { carrier_id: value })}
          />
        </div>
      ) : null}

      {/* AC (ACA account status) — ACA only */}
      {has("aca") ? (
        <div
          style={cellStyleFor("aca")}
          className={cellClassName("aca", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EnrollmentOptionMenu
            optionId={record.aca_status_id}
            options={optionsBySet.aca_status}
            emptyLabel="No AC status"
            surface="list"
            canEdit={capabilities.canEditFields}
            onChange={(value) => void onPatch(record.id, { aca_status_id: value })}
          />
        </div>
      ) : null}

      {/* Consent — ACA only; Yes/Not Yet is a binary field, so it's a tick box. */}
      {has("consent") ? (
        <div
          style={cellStyleFor("consent")}
          className={cellClassName("consent", "flex shrink-0 items-center justify-center px-2 py-2.5")}
        >
          <EnrollmentConsentToggle
            optionId={record.consent_id}
            options={optionsBySet.consent}
            canEdit={capabilities.canEditFields}
            onChange={(value) => void onPatch(record.id, { consent_id: value })}
          />
        </div>
      ) : null}

      {/* Platform — ACA only */}
      {has("platform") ? (
        <div
          style={cellStyleFor("platform")}
          className={cellClassName("platform", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EnrollmentOptionMenu
            optionId={record.platform_id}
            options={optionsBySet.platform}
            emptyLabel="No platform"
            surface="list"
            canEdit={capabilities.canEditFields}
            onChange={(value) => void onPatch(record.id, { platform_id: value })}
          />
        </div>
      ) : null}

      {/* PCP 2025 (labeled "PCP" for Medicare, which has a single PCP field) */}
      {has("pcp2025") ? (
        <div
          style={cellStyleFor("pcp2025")}
          className={cellClassName("pcp2025", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EditableCustomCell
            column={{
              id: "pcp_2025",
              type: "text",
              key: "pcp_2025",
              label: columnByKey.get("pcp2025")?.label ?? "PCP 2025",
            }}
            value={record.pcp_2025}
            canEdit={capabilities.canEditFields}
            onSave={(next) => onPatch(record.id, { pcp_2025: next })}
            className="w-full"
          />
        </div>
      ) : null}

      {/* PCP 2026 — ACA only */}
      {has("pcp2026") ? (
        <div
          style={cellStyleFor("pcp2026")}
          className={cellClassName("pcp2026", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EditableCustomCell
            column={{
              id: "pcp_2026",
              type: "text",
              key: "pcp_2026",
              label: columnByKey.get("pcp2026")?.label ?? "PCP 2026",
            }}
            value={record.pcp_2026}
            canEdit={capabilities.canEditFields}
            onSave={(next) => onPatch(record.id, { pcp_2026: next })}
            className="w-full"
          />
        </div>
      ) : null}

      {/* Due Date */}
      {has("due") ? (
        <div
          style={cellStyleFor("due")}
          className={cellClassName("due", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <EditableCustomCell
            column={{
              id: "due_date",
              type: "date",
              key: "due_date",
              label: columnByKey.get("due")?.label ?? "Due Date",
            }}
            value={record.due_date}
            canEdit={capabilities.canEditFields}
            onSave={(next) => onPatch(record.id, { due_date: next })}
            className="w-full !text-xs !font-medium !text-[#6b778c]"
          />
        </div>
      ) : null}

      {/* Created by */}
      {has("createdBy") ? (
        <div
          style={cellStyleFor("createdBy")}
          className={cellClassName("createdBy", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <span className="truncate text-xs font-medium text-[#42526e]">
            {personLabel(record.created_by_email, peopleByEmail)}
          </span>
        </div>
      ) : null}

      {/* Created time */}
      {has("createdAt") ? (
        <div
          style={cellStyleFor("createdAt")}
          className={cellClassName("createdAt", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <RelativeTime
            value={record.created_at}
            className="truncate text-xs font-medium text-[#6b778c]"
          />
        </div>
      ) : null}

      {/* Last edited by */}
      {has("updatedBy") ? (
        <div
          style={cellStyleFor("updatedBy")}
          className={cellClassName("updatedBy", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <span className="truncate text-xs font-medium text-[#42526e]">
            {record.updated_by_email
              ? personLabel(record.updated_by_email, peopleByEmail)
              : "-"}
          </span>
        </div>
      ) : null}

      {/* Last edited time */}
      {has("updated") ? (
        <div
          style={cellStyleFor("updated")}
          className={cellClassName("updated", "flex shrink-0 items-center px-3 py-2.5")}
        >
          <RelativeTime
            value={record.updated_at}
            className="truncate text-xs font-medium text-[#6b778c]"
          />
        </div>
      ) : null}

      {customColumns.map((column) => {
        const configColumn = column.configColumn;
        if (!configColumn) return null;
        return (
          <div
            key={column.key}
            style={cellStyleFor(column.key)}
            className={cellClassName(
              column.key,
              `flex min-w-0 shrink-0 items-center px-3 py-2.5 ${
                configColumn.type === "checkbox" ? "justify-center" : ""
              }`
            )}
          >
            <EditableCustomCell
              column={configColumn}
              value={record.custom_values?.[configColumn.key]}
              options={customOptionsByColumnId.get(configColumn.id) ?? []}
              people={customPeople}
              optionLabelById={customOptionLabelById}
              personLabelByEmail={peopleByEmail}
              canEdit={capabilities.canEditFields}
              onSave={(next) =>
                void onPatch(record.id, {
                  custom_values: { [configColumn.key]: next },
                })
              }
              className={configColumn.type === "checkbox" ? "" : "w-full"}
            />
          </div>
        );
      })}

      {has("qc") ? (
        <div
          style={cellStyleFor("qc")}
          className={cellClassName(
            "qc",
            "flex shrink-0 items-center justify-center px-2 py-2.5"
          )}
        >
          <QCCheckButton
            record={record}
            stage={stage}
            canEdit={capabilities.canReviewQC}
            onToggle={() => onPatch(record.id, { qc_checked: !record.qc_checked_at })}
          />
        </div>
      ) : null}
    </div>
  );
}

// Consent is a two-state field (Yes / Not Yet) so a click-to-toggle checkbox
// is faster than opening a dropdown. Falls back to the generic dropdown if the
// option set doesn't have the expected Yes/other shape (e.g. mid-edit in
// Option sets management).
function EnrollmentConsentToggle({
  optionId,
  options,
  field = false,
  canEdit = true,
  onChange,
}: {
  optionId: string | null;
  options: EnrollmentOption[];
  field?: boolean;
  canEdit?: boolean;
  onChange: (value: string) => void;
}) {
  const yesOption =
    options.find((option) => option.label.trim().toLowerCase() === "yes") ?? null;
  const otherOption = options.find((option) => option.id !== yesOption?.id) ?? null;
  if (!yesOption || !otherOption) {
    return (
      <EnrollmentOptionMenu
        optionId={optionId}
        options={options}
        emptyLabel="No consent"
        surface={field ? "form-field" : "form-bare"}
        canEdit={canEdit}
        onChange={onChange}
      />
    );
  }

  const current = optionId ? options.find((option) => option.id === optionId) ?? null : null;
  const checked = current?.id === yesOption.id;
  const label = current?.label ?? "Not set";

  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={(event) => {
        event.stopPropagation();
        onChange(checked ? otherOption.id : yesOption.id);
      }}
      aria-label={`Consent: ${label}`}
      aria-pressed={checked}
      title={label}
      className={
        field
          ? DETAIL_FIELD_BUTTON_CLASS
          : "inline-flex h-7 w-7 items-center justify-center rounded text-[#42526e] transition hover:bg-[#f4f5f7] hover:text-[#172b4d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#deebff] disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-2 transition ${
          checked ? "border-[#00875a] bg-[#00875a]" : "border-[#c1c7d0] bg-white"
        }`}
      >
        {checked ? <Check className="h-3 w-3 text-white" /> : null}
      </span>
      {field ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
    </button>
  );
}

// Generic inline-editable pill for any option-set field (Payment, Carrier, AC,
// Platform) — same interaction as EnrollmentStagePill, minus the terminal-stage
// handling that's specific to Stage.
function EnrollmentOptionMenu({
  optionId,
  options,
  emptyLabel,
  placeholderLabel,
  surface = "form-bare",
  canEdit = true,
  onChange,
}: {
  optionId: string | null;
  options: EnrollmentOption[];
  emptyLabel: string;
  placeholderLabel?: string;
  surface?: "list" | "form-bare" | "form-field";
  canEdit?: boolean;
  onChange: (value: string) => void;
}) {
  const {
    isOpen,
    toggle,
    triggerRef,
    menuRef,
    menuStyle,
    closeMenu,
    closeMenuForTab,
  } = useAnchoredMenu();
  const option = optionId ? options.find((item) => item.id === optionId) ?? null : null;
  const drawsOwnChrome = surface === "form-field";
  const rendersIdentityBadge = surface === "list";
  const showsChevron = surface !== "list";
  const emptyDisplayLabel = placeholderLabel ?? emptyLabel;
  const menuLabel = emptyDisplayLabel.replace(/^(No|Select)\s+/i, "");
  // Identity badge (CS CategoryBadge language): these values describe what
  // the record is, so each option keeps its own solid colour. Stage remains
  // distinguishable through its tinted workflow-state badge.
  const style = enrollmentIdentityBadgeStyle(option);
  const identityBadgeClass =
    "inline-flex max-w-full min-w-0 items-center truncate rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.025em]";

  return (
    <span className="block min-w-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={!canEdit}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={option?.label ?? emptyDisplayLabel}
        className={
          drawsOwnChrome
            ? DETAIL_FIELD_BUTTON_CLASS
            : rendersIdentityBadge
              ? "inline-flex max-w-full min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.025em] disabled:cursor-not-allowed disabled:opacity-60"
              : "flex w-full min-w-0 items-center disabled:cursor-not-allowed disabled:opacity-60"
        }
        style={
          rendersIdentityBadge
            ? {
                backgroundColor: style.bg,
                color: style.fg,
              }
            : undefined
        }
      >
        {option && !rendersIdentityBadge ? (
          <span
            className={identityBadgeClass}
            style={{ backgroundColor: style.bg, color: style.fg }}
            title={option.label}
          >
            {option.label}
          </span>
        ) : (
          <span
            className={`min-w-0 truncate text-left ${
              rendersIdentityBadge ? "" : "flex-1"
            } ${
              !rendersIdentityBadge && !option ? "font-normal text-[#97a0af]" : ""
            }`}
          >
            {option?.label ?? emptyDisplayLabel}
          </span>
        )}
        {/* Identity badges match CS CategoryBadge: no chevron in List. */}
        {showsChevron ? <ChevronDown className="ml-auto h-4 w-4 shrink-0 opacity-60" /> : null}
      </button>
      {isOpen
        ? createPortal(
            <SearchableListboxPanel
              menuRef={menuRef}
              menuStyle={menuStyle}
              ariaLabel={menuLabel}
              queryPlaceholder={`Search ${menuLabel.toLowerCase()}…`}
              emptyMessage={`No matching ${menuLabel.toLowerCase()}.`}
              choices={options.map((item) => ({
                value: item.id,
                label: item.label,
              }))}
              selectedValue={optionId}
              onSelect={(value) => {
                onChange(value);
                closeMenu({ restoreFocus: true });
              }}
              onTabExit={closeMenuForTab}
              renderChoice={(choice, state) => {
                const choiceOption = options.find((item) => item.id === choice.value) ?? null;
                const choiceStyle = enrollmentIdentityBadgeStyle(choiceOption);
                return (
                  <>
                    {choiceOption ? (
                      <span
                        className={identityBadgeClass}
                        style={{
                          backgroundColor: choiceStyle.bg,
                          color: choiceStyle.fg,
                        }}
                      >
                        {choice.label}
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-medium leading-5">
                        {choice.label}
                      </span>
                    )}
                    {state.selected ? (
                      <Check className="ml-auto h-4 w-4 shrink-0 text-[#0c66e4]" />
                    ) : null}
                  </>
                );
              }}
            />,
            document.body
          )
        : null}
    </span>
  );
}

export function EnrollmentPersonMenu({
  value,
  peopleByEmail,
  emptyLabel,
  placeholderLabel,
  surface,
  variant = "default",
  canEdit = true,
  onChange,
}: {
  value: string | null;
  peopleByEmail: Map<string, string>;
  emptyLabel: string;
  placeholderLabel?: string;
  surface: "list" | "form-bare" | "form-field";
  variant?: "default" | "select" | "assignee";
  canEdit?: boolean;
  onChange: (value: string | null) => void;
}) {
  const {
    isOpen,
    toggle,
    triggerRef,
    menuRef,
    menuStyle,
    closeMenu,
    closeMenuForTab,
  } = useAnchoredMenu();
  const drawsOwnChrome = surface === "form-field";
  const showsAssignCallToAction = surface === "list";
  const usesSelectChrome = variant === "select";
  const usesAssigneeChrome = variant === "assignee";
  const placeholder = placeholderLabel ?? emptyLabel;
  const options = [...peopleByEmail.entries()]
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  const selectedLabel = value
    ? peopleByEmail.get(value) ?? formatEmailAsName(value)
    : emptyLabel;
  const renderAssigneeEmpty = () => (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm font-normal text-[#97a0af]">
      <AvatarStack emails={[]} />
      <span className="truncate">{emptyLabel}</span>
    </span>
  );
  const renderSelectedAssignee = (className: string) => (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      <AvatarStack emails={value ? [value] : []} labelByEmail={peopleByEmail} max={1} />
      <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
    </span>
  );
  if (!canEdit) {
    if (drawsOwnChrome) {
      return (
        <span
          className={`${usesAssigneeChrome ? TASK_ASSIGNEE_BUTTON_CLASS : DETAIL_FIELD_DISPLAY_CLASS} flex min-w-0 items-center gap-2 bg-[#f4f5f7]`}
          title={selectedLabel}
        >
          {usesSelectChrome ? (
            <span className={`min-w-0 flex-1 truncate ${value ? "text-[#172b4d]" : "font-normal text-[#6b778c]"}`}>
              {value ? selectedLabel : placeholder}
            </span>
          ) : usesAssigneeChrome ? (
          value ? renderSelectedAssignee("text-[#172b4d]") : renderAssigneeEmpty()
          ) : value ? (
            <>
              <Initials email={value} label={selectedLabel} />
              <span className="min-w-0 flex-1 truncate text-[#172b4d]">
                {selectedLabel}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate font-normal text-[#6b778c]">
              {emptyLabel}
            </span>
          )}
        </span>
      );
    }

    return value ? (
      <span
        className="flex min-w-0 items-center gap-1.5 rounded text-xs font-semibold text-[#42526e]"
        title={selectedLabel}
      >
        <Initials email={value} label={selectedLabel} />
        <span className="min-w-0 truncate">{selectedLabel}</span>
      </span>
    ) : (
      <span
        className="block min-w-0 truncate text-xs font-semibold text-[#6b778c]"
        title={emptyLabel}
      >
        {emptyLabel}
      </span>
    );
  }

  return (
    <span className="block min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={selectedLabel}
        className={
          usesSelectChrome
            ? `${drawsOwnChrome ? DETAIL_FIELD_BUTTON_CLASS : "flex w-full min-w-0"} items-center justify-between gap-2`
            : usesAssigneeChrome
              ? `${drawsOwnChrome ? TASK_ASSIGNEE_BUTTON_CLASS : "flex w-full min-w-0"}`
              : drawsOwnChrome
                ? DETAIL_FIELD_BUTTON_CLASS
                : "flex w-full min-w-0 items-center"
        }
      >
        {usesSelectChrome ? (
          <span
            className={`min-w-0 flex-1 truncate text-left text-sm leading-5 ${
              value ? "font-semibold text-[#172b4d]" : "font-normal text-[#97a0af]"
            }`}
          >
            {value ? selectedLabel : placeholder}
          </span>
        ) : usesAssigneeChrome ? (
          value ? renderSelectedAssignee("text-sm font-semibold text-[#172b4d]") : renderAssigneeEmpty()
        ) : value ? (
          <span
            className={`flex min-w-0 items-center gap-1.5 rounded text-left font-semibold transition ${
              drawsOwnChrome
                ? "flex-1 text-sm text-[#172b4d]"
                : "text-xs text-[#42526e] hover:text-[#0c66e4]"
            }`}
          >
            <Initials email={value} label={selectedLabel} />
            <span
              className={
                drawsOwnChrome
                  ? "min-w-0 flex-1 leading-tight"
                  : "whitespace-nowrap"
              }
            >
              <span className={drawsOwnChrome ? "block truncate" : undefined}>
                {selectedLabel}
              </span>
            </span>
          </span>
        ) : (
          <span
            className={
              showsAssignCallToAction
                ? "inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] bg-white px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff]"
                : "inline-flex min-w-0 items-center gap-1.5 text-sm font-normal text-[#97a0af]"
            }
          >
            <UserPlus className={showsAssignCallToAction ? "h-3 w-3" : "h-4 w-4"} />
            {showsAssignCallToAction ? "Assign" : emptyLabel}
          </span>
        )}
        {usesSelectChrome || (drawsOwnChrome && !usesAssigneeChrome) ? (
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 opacity-60" />
        ) : null}
      </button>
      {isOpen
        ? createPortal(
            <SearchableListboxPanel
              menuRef={menuRef}
              menuStyle={menuStyle}
              className="min-w-[14rem]"
              ariaLabel={placeholder}
              queryPlaceholder={`Search ${placeholder.toLowerCase()} or email…`}
              emptyMessage={`No matching ${placeholder.toLowerCase()}.`}
              pinnedChoices={[{ value: "", label: usesSelectChrome ? placeholder : emptyLabel }]}
              choices={options.map(({ email, name }) => ({
                value: email,
                label: name,
                keywords: [email],
              }))}
              selectedValue={value ?? ""}
              onSelect={(selectedValue) => {
                onChange(selectedValue || null);
                closeMenu({ restoreFocus: true });
              }}
              onTabExit={closeMenuForTab}
              renderChoice={(choice, state) => {
                if (!choice.value) {
                  return (
                    <>
                      {usesSelectChrome ? null : (
                        <UserPlus className="h-4 w-4 shrink-0 text-[#7a869a]" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium leading-5">
                        {choice.label}
                      </span>
                      {state.selected ? (
                        <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" />
                      ) : null}
                    </>
                  );
                }
                return usesSelectChrome ? (
                  <>
                    <span className="min-w-0 flex-1 truncate font-medium leading-5">
                      {choice.label}
                    </span>
                    {state.selected ? (
                      <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" />
                    ) : null}
                  </>
                ) : (
                  <>
                    <Initials email={choice.value} label={choice.label} />
                    <span className="min-w-0 flex-1 truncate font-medium leading-5">
                      {choice.label}
                    </span>
                    {state.selected ? (
                      <Check className="h-4 w-4 shrink-0 text-[#0c66e4]" />
                    ) : null}
                  </>
                );
              }}
            />,
            document.body
          )
        : null}
    </span>
  );
}

function QCCheckButton({
  record,
  stage,
  canEdit = true,
  onToggle,
}: {
  record: EnrollmentRecordWithStats;
  stage: EnrollmentOption | null;
  canEdit?: boolean;
  onToggle: () => Promise<void>;
}) {
  if (!stage?.triggers_qc) {
    return <span className="text-[11px] font-semibold text-[#97a0af]">-</span>;
  }

  const checked = Boolean(record.qc_checked_at);
  const className = checked
    ? "inline-flex h-5 w-5 items-center justify-center rounded border border-[#36b37e] bg-[#e3fcef] text-[#006644]"
    : "inline-flex h-5 w-5 items-center justify-center rounded border border-[#c1c7d0] bg-white text-transparent hover:text-[#6b778c]";

  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={(event) => {
        event.stopPropagation();
        void onToggle();
      }}
      className={`${className} transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60`}
      aria-label={checked ? "Clear QC check" : "Mark QC checked"}
      title={checked ? "QC checked" : "Needs QC"}
    >
      {checked ? <Check className="h-3.5 w-3.5" /> : null}
    </button>
  );
}

function EnrollmentStagePill({
  stageId,
  stages,
  field = false,
  canEdit = true,
  onChange,
}: {
  stageId: string | null;
  stages: EnrollmentOption[];
  field?: boolean;
  canEdit?: boolean;
  onChange: (stageId: string) => Promise<void>;
}) {
  const {
    isOpen,
    toggle,
    triggerRef,
    menuRef,
    menuStyle,
    closeMenu,
    closeMenuForTab,
  } = useAnchoredMenu();
  const stage = stageId ? stages.find((option) => option.id === stageId) ?? null : null;
  // Workflow-state badge (CS StatusPill language): tinted, not solid.
  const style = enrollmentStateBadgeStyle(stage);
  const label = stage?.label ?? "No stage";
  const pill = field ? (
    <span className={DETAIL_FIELD_BUTTON_CLASS}>
      <span
        className="inline-flex max-w-full min-w-0 items-center rounded px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-wide"
        style={{ backgroundColor: style.bg, color: style.fg }}
      >
        <span className="truncate">{label}</span>
      </span>
      <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
    </span>
  ) : (
    <span
      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-wide"
      style={{ backgroundColor: style.bg, color: style.fg }}
    >
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {canEdit ? <ChevronDown className="h-3 w-3 shrink-0" /> : null}
    </span>
  );

  return (
    <span className="block min-w-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={!canEdit}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={label}
        className="block w-full min-w-0 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pill}
      </button>
      {isOpen
        ? createPortal(
            <SearchableListboxPanel
              menuRef={menuRef}
              menuStyle={menuStyle}
              ariaLabel="Stage"
              queryPlaceholder="Search stages…"
              emptyMessage="No matching stages."
              choices={stages.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
              selectedValue={stageId}
              onSelect={(value) => {
                void onChange(value);
                closeMenu({ restoreFocus: true });
              }}
              onTabExit={closeMenuForTab}
            />,
            document.body
          )
        : null}
    </span>
  );
}

function EnrollmentSortTh({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`flex w-full min-w-0 items-center gap-1 whitespace-nowrap uppercase transition ${
        active ? "text-[#0c66e4]" : "hover:text-[#172b4d]"
      }`}
    >
      <span className="truncate">{label}</span>
      {active ? (
        sortDir === "asc" ? (
          <ArrowUp className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowDown className="h-3 w-3 shrink-0" />
        )
      ) : null}
    </button>
  );
}

function EnrollmentDrawer({
  record,
  peopleByEmail,
  agentsByEmail,
  mentionMembers,
  optionsById,
  optionsBySet,
  detailColumns,
  visibleColumnKeys,
  requiredColumnKeys,
  columnByKey,
  tableColumnOptions,
  currentEmail,
  mutationSourceId,
  highlightCommentId,
  isManager,
  agentScopeEmails,
  onClose,
  onPatch,
  onArchive,
  onParentUpdatedAt,
  onParentRefresh,
}: {
  record: EnrollmentRecordWithStats;
  peopleByEmail: Map<string, string>;
  agentsByEmail: Map<string, string>;
  mentionMembers: TaskAssignee[];
  optionsById: Map<string, EnrollmentOption>;
  optionsBySet: EnrollmentOptionsBySet;
  detailColumns: TableColumn[];
  visibleColumnKeys: ReadonlySet<EnrollmentColumnKey>;
  requiredColumnKeys: ReadonlySet<string>;
  columnByKey: ReadonlyMap<string, { label: string }>;
  tableColumnOptions: TableColumnOption[];
  currentEmail: string;
  mutationSourceId: string;
  highlightCommentId?: string | null;
  isManager: boolean;
  agentScopeEmails: readonly string[];
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onArchive: () => Promise<void>;
  onParentUpdatedAt?: (updatedAt: string) => void;
  onParentRefresh?: () => Promise<void> | void;
}) {
  const [detail, setDetail] = useState<EnrollmentDetail | null>(() =>
    getCachedEnrollmentDetail(record.id) ?? null,
  );
  const detailRequestSequenceRef = useRef(0);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [attachmentPreview, setAttachmentPreview] =
    useState<AttachmentPreview | null>(null);
  const [reloadStatus, setReloadStatus] = useState<"idle" | "failed">("idle");
  const [detailLiveStatus, setDetailLiveStatus] =
    useState<EnrollmentLiveStatus>("connecting");
  const loadedCommentLimitRef = useRef(
    Math.min(
      COMMENT_REFRESH_MAX,
      Math.max(COMMENT_PAGE_SIZE, detail?.comments.length ?? 0),
    ),
  );
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [reopenReasonOpen, setReopenReasonOpen] = useState(false);
  const [invalidKeys, setInvalidKeys] = useState<ReadonlySet<string>>(new Set());
  const lastForegroundDetailRefreshAtRef = useRef(0);
  const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
  const reopenTarget = getReopenStage(stage, optionsBySet.stage);
  const fubHref = record.fub_link ? formatExternalLink(record.fub_link) : null;
  const optionLabelById = new Map(
    tableColumnOptions.map((option) => [option.id, option.label])
  );
  const optionsByColumnId = new Map<string, TableColumnOption[]>();
  for (const option of tableColumnOptions) {
    const current = optionsByColumnId.get(option.column_id) ?? [];
    current.push(option);
    optionsByColumnId.set(option.column_id, current);
  }
  const customPeople = [...peopleByEmail.entries()].map(([email, name]) => ({
    email,
    name,
  }));
  const capabilities = resolveEnrollmentRecordCapabilitiesClient(
    record,
    currentEmail,
    isManager,
    agentScopeEmails
  );
  // Medicare's real data has no Payment/Consent/Platform/AC concepts and a
  // single Assignee + PCP field — see enrollmentColumnsForProgram() for the
  // list-view equivalent of this same trim.
  const isMedicare = record.program === "medicare";
  const showField = (key: string) =>
    visibleColumnKeys.has(key as EnrollmentColumnKey);
  const showClient = showField("client");
  const showStage = showField("stage");
  const showFub = showField("fub");
  const showDue = showField("due");
  const showPayment = !isMedicare && showField("payment");
  const showCarrier = showField("carrier");
  const showAca = !isMedicare && showField("aca");
  const showConsent = !isMedicare && showField("consent");
  const showPlatform = !isMedicare && showField("platform");
  const showAgent = showField("agent");
  const showCaller = !isMedicare && showField("caller");
  const showResponsible = showField("responsible");
  const showCreatedBy = showField("createdBy");
  const showPcp2025 = showField("pcp2025");
  const showPcp2026 = !isMedicare && showField("pcp2026");
  const showQc = showField("qc");
  const visibleDetailColumns = detailColumns;

  function markInvalid(key: string) {
    setInvalidKeys((current) => new Set([...current, key]));
  }
  function clearInvalid(key: string) {
    setInvalidKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }
  const isInvalid = (key: string) => invalidKeys.has(key);

  const reload = useCallback(async (
    force = false,
    source: "mutation" | "realtime" = "mutation",
  ) => {
    const sequence = ++detailRequestSequenceRef.current;
    const cached = getCachedEnrollmentDetail(record.id);
    if (cached) setDetail(cached);
    const age = getCachedEnrollmentDetailAgeMs(record.id);
    if (
      !force &&
      !highlightCommentId &&
      cached &&
      age !== null &&
      age <= ENROLLMENT_DETAIL_OPEN_FRESH_MS
    ) {
      return;
    }
    setReloadStatus("idle");
    try {
      const commentLimit =
        loadedCommentLimitRef.current > COMMENT_PAGE_SIZE
          ? loadedCommentLimitRef.current
          : undefined;
      const loaded = force
        ? await refreshEnrollmentDetail(record.id, {
            commentId: highlightCommentId,
            commentLimit,
            source,
          })
        : await fetchEnrollmentDetail(record.id, {
            commentId: highlightCommentId,
            commentLimit,
            source: cached ? "revalidate" : "open",
          });
      if (sequence !== detailRequestSequenceRef.current) return;
      setDetail(loaded);
      loadedCommentLimitRef.current = Math.min(
        COMMENT_REFRESH_MAX,
        Math.max(COMMENT_PAGE_SIZE, loaded.comments.length),
      );
      setReloadStatus("idle");
    } catch {
      if (sequence === detailRequestSequenceRef.current) {
        setReloadStatus("failed");
      }
      // Keep a warm cached detail visible when a background revalidation fails.
    }
  }, [highlightCommentId, record.id]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeEnrollmentDataInvalidation((invalidation) => {
      const scope = enrollmentInvalidationReconcileScope(
        invalidation,
        mutationSourceId,
      );
      if (!scope || (invalidation.recordId && invalidation.recordId !== record.id)) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reload(true, "realtime"), ENROLLMENT_LIVE_EVENT_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [mutationSourceId, record.id, reload]);

  useEffect(() => {
    const sb = getBrowserSupabase();
    if (!sb) {
      const degradedTimer = window.setTimeout(
        () => setDetailLiveStatus("degraded"),
        0,
      );
      return () => window.clearTimeout(degradedTimer);
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    let hasSubscribed = false;
    const schedule = () => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => void reload(true, "realtime"),
        ENROLLMENT_LIVE_EVENT_DEBOUNCE_MS,
      );
    };
    const channel = sb
      .channel(enrollmentRoomTopic(record.id))
      .on(
        "broadcast",
        { event: "changed" },
        (message: { payload?: Record<string, unknown> }) => {
          if (isOwnRealtimeMutation(mutationSourceId, message.payload?.sourceId)) return;
          schedule();
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          const reconnected = hasSubscribed;
          hasSubscribed = true;
          setDetailLiveStatus("live");
          if (reconnected) schedule();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setDetailLiveStatus("degraded");
        } else {
          setDetailLiveStatus("connecting");
        }
      });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [mutationSourceId, record.id, reload]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (canRefreshEnrollmentData(document.visibilityState, navigator.onLine)) {
        void reload(true, "realtime");
      }
    }, enrollmentLivePollInterval(detailLiveStatus));
    return () => window.clearInterval(interval);
  }, [detailLiveStatus, reload]);

  useEffect(() => {
    if (!highlightCommentId) return;
    const timer = window.setTimeout(() => setTab("comments"), 0);
    return () => window.clearTimeout(timer);
  }, [highlightCommentId]);

  useEffect(() => {
    const refreshFromForeground = () => {
      if (!canRefreshEnrollmentData(document.visibilityState, navigator.onLine)) {
        return;
      }
      const now = Date.now();
      if (
        now - lastForegroundDetailRefreshAtRef.current <
        ENROLLMENT_LIVE_REFRESH_THROTTLE_MS
      ) {
        return;
      }
      lastForegroundDetailRefreshAtRef.current = now;
      getBrowserSupabase()?.realtime.connect();
      void reload(true);
    };
    window.addEventListener("focus", refreshFromForeground);
    window.addEventListener("online", refreshFromForeground);
    document.addEventListener("visibilitychange", refreshFromForeground);
    return () => {
      window.removeEventListener("focus", refreshFromForeground);
      window.removeEventListener("online", refreshFromForeground);
      document.removeEventListener("visibilitychange", refreshFromForeground);
    };
  }, [reload]);

  const loadOlderComments = useCallback(async () => {
    if (!detail?.commentsHasMore) return;
    const oldest = [...detail.comments]
      .filter((comment) => typeof comment.created_at === "string")
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id))[0];
    if (!oldest) return;
    const params = new URLSearchParams({
      comments_before_created_at: String(oldest.created_at),
      comments_before_id: oldest.id,
      request_source: "open",
    });
    const response = await fetch(`/api/enrollment/${record.id}/detail?${params.toString()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Could not load older comments.");
    const older = (await response.json()) as EnrollmentDetail;
    setDetail((current) => {
      if (!current) return older;
      const byId = new Map(current.comments.map((comment) => [comment.id, comment]));
      for (const comment of older.comments) byId.set(comment.id, comment);
      const next = {
        ...current,
        comments: [...byId.values()].sort(
          (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id)
        ),
        commentsHasMore: older.commentsHasMore,
      };
      loadedCommentLimitRef.current = Math.min(
        COMMENT_REFRESH_MAX,
        Math.max(COMMENT_PAGE_SIZE, next.comments.length),
      );
      setCachedEnrollmentDetail(record.id, next);
      return next;
    });
  }, [detail, record.id]);

  const reloadDetailAndParent = useCallback(async () => {
    await reload(true);
    await onParentRefresh?.();
  }, [onParentRefresh, reload]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void reload();
    });
    return () => {
      active = false;
    };
  }, [reload]);

  function reopen() {
    if (!reopenTarget || !capabilities.canReopen) return;
    setReopenReasonOpen(true);
  }

  async function submitReopen(reason: string): Promise<boolean> {
    if (!reopenTarget || !capabilities.canReopen) return false;
    try {
      await onPatch({ stage_id: reopenTarget.id, reopen_reason: reason });
      setReopenReasonOpen(false);
      return true;
    } catch {
      return false;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[calc(100vh-2rem)] max-h-[760px] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[#dfe1e6] px-5 py-3">
          <span className="font-mono text-sm font-bold text-[#97a0af]">
            {enrollmentDisplayKey(record.display_number, record.program)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1.5 text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* On wide screens each column owns its scrolling, which is what keeps
            the comment composer docked at the bottom no matter how long the
            thread gets. Narrow screens keep the simpler single-scroll layout. */}
        <div className="flex-1 overflow-y-auto lg:overflow-hidden">
          <div className="grid min-h-full grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_280px]">
            <main className="flex min-w-0 flex-col gap-3 p-4 lg:min-h-0 lg:overflow-hidden lg:p-5">
              {showClient ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>
                    {columnByKey.get("client")?.label ?? "Client Name"}
                    {requiredColumnKeys.has("client") ? REQUIRED_MARK : null}
                  </span>
                  <EditableInput
                    value={record.client_name ?? ""}
                    placeholder="Client name"
                    canEdit={capabilities.canEditContent}
                    className={COMPACT_DETAIL_INPUT_CLASS}
                    required={requiredColumnKeys.has("client")}
                    invalid={isInvalid("client")}
                    onRejectEmpty={() => markInvalid("client")}
                    onEditStart={() => clearInvalid("client")}
                    onSave={(value) => onPatch({ client_name: value })}
                  />
                </label>
              ) : null}

              {showFub ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className="block text-xs font-bold uppercase text-[#6b778c]">
                    {columnByKey.get("fub")?.label ?? "FUB Link"}
                    {requiredColumnKeys.has("fub") ? REQUIRED_MARK : null}
                  </span>
                  <div className="flex gap-1.5">
                    <EditableInput
                      value={record.fub_link ?? ""}
                      placeholder="No FUB link"
                      canEdit={capabilities.canEditContent}
                      className={COMPACT_DETAIL_INPUT_CLASS}
                      required={requiredColumnKeys.has("fub")}
                      invalid={isInvalid("fub")}
                      onRejectEmpty={() => markInvalid("fub")}
                      onEditStart={() => clearInvalid("fub")}
                      onSave={(value) => onPatch({ fub_link: value })}
                    />
                    {fubHref ? (
                      <a
                        href={fubHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open FUB link"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-[#dfe1e6] bg-white text-[#44546f] transition hover:border-[#85b8ff] hover:bg-[#e9f2ff] hover:text-[#0c66e4]"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                </label>
              ) : null}

              <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className={LABEL_CLASS}>
                  {columnByKey.get("description")?.label ?? "Description"}
                  {requiredColumnKeys.has("description") ? REQUIRED_MARK : null}
                </span>
                <EditableTextarea
                  value={record.description ?? ""}
                  placeholder="No description"
                  canEdit={capabilities.canEditContent}
                  className={COMPACT_DESCRIPTION_CLASS}
                  onSave={(value) => onPatch({ description: value })}
                />
              </label>

              <AttachmentStrip
                attachments={detail?.attachments ?? []}
                onPreviewAttachment={setAttachmentPreview}
              />

              <section className="flex min-h-0 flex-1 flex-col gap-3 border-t border-[#dfe1e6] pt-4">
                <div className="flex shrink-0 flex-wrap items-center gap-5 border-b border-[#dfe1e6]">
                  <DrawerTab
                    label="Comments"
                    count={record.comment_count}
                    active={tab === "comments"}
                    onClick={() => setTab("comments")}
                  />
                  <DrawerTab
                    label="Activity"
                    count={detail?.activity.length ?? 0}
                    active={tab === "activity"}
                    onClick={() => setTab("activity")}
                  />
                </div>

                {!detail ? (
                  <DetailSkeleton />
                ) : (
                  <>
                    {reloadStatus === "failed" ? (
                      <div
                        className="flex shrink-0 items-center justify-between gap-3 rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-xs font-semibold text-[#bf2600]"
                        role="alert"
                      >
                        <span>Could not refresh the latest details.</span>
                        <button
                          type="button"
                          onClick={() => void reload(true)}
                          className="rounded bg-white px-2 py-1 text-[#bf2600] shadow-sm transition hover:bg-[#fff7f5]"
                        >
                          Retry
                        </button>
                      </div>
                    ) : null}
                    {tab === "comments" ? (
                      <CommentThread
                    taskId={record.id}
                    apiBase="/api/enrollment"
                    roomTopic={enrollmentRoomTopic(record.id)}
                    reactionTopic={enrollmentReactionTopic(record.id)}
                    mutationSourceId={mutationSourceId}
                    mutationSourceHeader={ENROLLMENT_MUTATION_SOURCE_HEADER}
                    realtimeManagedExternally
                    reactionsEnabled
                    reactionCache="enrollment"
                    onCommitted={() =>
                      publishEnrollmentDataInvalidation({
                        recordId: record.id,
                        sourceId: mutationSourceId,
                      })
                    }
                    currentEmail={currentEmail}
                    members={mentionMembers}
                    comments={detail.comments}
                    commentsHasMore={detail.commentsHasMore}
                    onLoadOlder={loadOlderComments}
                    highlightCommentId={highlightCommentId}
                    onReload={reloadDetailAndParent}
                    onParentUpdatedAt={onParentUpdatedAt}
                      />
                    ) : (
                      <ActivityFeed
                        activity={detail.activity}
                        personLabelByEmail={peopleByEmail}
                      />
                    )}
                  </>
                )}
              </section>
            </main>

          <aside className="space-y-4 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0 lg:overflow-y-auto">
            <div className="flex flex-col gap-3">
              {showStage ? (
                <FieldBlock
                  className="order-2"
                  label={columnByKey.get("stage")?.label ?? "Stage"}
                  required={requiredColumnKeys.has("stage")}
                >
                  <EnrollmentStagePill
                    stageId={record.stage_id}
                    stages={optionsBySet.stage}
                    field
                    canEdit={capabilities.canChangeStage}
                    onChange={(value) => onPatch({ stage_id: value })}
                  />
                </FieldBlock>
              ) : null}

              {showDue ? (
                <FieldBlock
                  className="order-3"
                  label={`${columnByKey.get("due")?.label ?? "Due date"} (month/day/year)`}
                  required={requiredColumnKeys.has("due")}
                >
                  <input
                    type="date"
                    value={formatDateInput(record.due_date)}
                    placeholder="month/day/year"
                    disabled={!capabilities.canEditFields}
                    onChange={(event) => {
                      const nextDueDate = event.target.value || null;
                      if (nextDueDate === formatDateInput(record.due_date)) return;
                      void onPatch({ due_date: nextDueDate });
                    }}
                    className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-medium text-[#42526e] disabled:cursor-not-allowed disabled:bg-[#f4f5f7]`}
                  />
                </FieldBlock>
              ) : null}

              {showPayment ? (
                <FieldBlock
                  className="order-4"
                  label={columnByKey.get("payment")?.label ?? "Payment"}
                  required={requiredColumnKeys.has("payment")}
                >
                  <EnrollmentOptionMenu
                    optionId={record.payment_status_id}
                    options={optionsBySet.payment_status}
                    emptyLabel="No payment"
                    surface="form-field"
                    canEdit={capabilities.canEditFields}
                    onChange={(value) => void onPatch({ payment_status_id: value })}
                  />
                </FieldBlock>
              ) : null}

              {showCarrier ? (
                <FieldBlock
                  className="order-4"
                  label={columnByKey.get("carrier")?.label ?? "Carrier"}
                  required={requiredColumnKeys.has("carrier")}
                >
                  <EnrollmentOptionMenu
                    optionId={record.carrier_id}
                    options={optionsBySet.carrier}
                    emptyLabel="No carrier"
                    surface="form-field"
                    canEdit={capabilities.canEditFields}
                    onChange={(value) => void onPatch({ carrier_id: value })}
                  />
                </FieldBlock>
              ) : null}

              {showAca ? (
                  <FieldBlock
                    className="order-4"
                    label={columnByKey.get("aca")?.label ?? "AC"}
                    required={requiredColumnKeys.has("aca")}
                  >
                    <EnrollmentOptionMenu
                      optionId={record.aca_status_id}
                      options={optionsBySet.aca_status}
                      emptyLabel="No AC status"
                      surface="form-field"
                      canEdit={capabilities.canEditFields}
                      onChange={(value) => void onPatch({ aca_status_id: value })}
                    />
                  </FieldBlock>
              ) : null}

              {showConsent ? (
                  <FieldBlock
                    className="order-4"
                    label={columnByKey.get("consent")?.label ?? "Consent"}
                    required={requiredColumnKeys.has("consent")}
                  >
                    <EnrollmentConsentToggle
                      optionId={record.consent_id}
                      options={optionsBySet.consent}
                      field
                      canEdit={capabilities.canEditFields}
                      onChange={(value) => void onPatch({ consent_id: value })}
                    />
                  </FieldBlock>
              ) : null}

              {showPlatform ? (
                  <FieldBlock
                    className="order-4"
                    label={columnByKey.get("platform")?.label ?? "Platform"}
                    required={requiredColumnKeys.has("platform")}
                  >
                    <EnrollmentOptionMenu
                      optionId={record.platform_id}
                      options={optionsBySet.platform}
                      emptyLabel="No platform"
                      surface="form-field"
                      canEdit={capabilities.canEditFields}
                      onChange={(value) => void onPatch({ platform_id: value })}
                    />
                  </FieldBlock>
              ) : null}

              {showAgent ? (
                <FieldBlock
                  className="order-1"
                  label={columnByKey.get("agent")?.label ?? "Agent"}
                  required={requiredColumnKeys.has("agent")}
                  invalid={isInvalid("agent")}
                >
                  <EnrollmentPersonMenu
                    value={record.agent_email}
                    peopleByEmail={agentsByEmail}
                    emptyLabel="Unassigned"
                    placeholderLabel="Agent"
                    surface="form-field"
                    variant="assignee"
                    canEdit={capabilities.canTransferAgent}
                    onChange={(value) => {
                      if (requiredColumnKeys.has("agent") && !value) {
                        markInvalid("agent");
                        return;
                      }
                      clearInvalid("agent");
                      void onPatch({ agent_email: value });
                    }}
                  />
                </FieldBlock>
              ) : null}

              {showCaller ? (
                <FieldBlock
                  className="order-1"
                  label={columnByKey.get("caller")?.label ?? "Caller"}
                  required={requiredColumnKeys.has("caller")}
                >
                  <EnrollmentPersonMenu
                    value={record.caller_email}
                    peopleByEmail={peopleByEmail}
                    emptyLabel="Unassigned"
                    placeholderLabel="Caller"
                    surface="form-field"
                    variant="assignee"
                    canEdit={capabilities.canAssignPeople}
                    onChange={(value) => void onPatch({ caller_email: value })}
                  />
                </FieldBlock>
              ) : null}

              {showResponsible ? (
                <FieldBlock
                  className="order-1"
                  label={
                    columnByKey.get("responsible")?.label ??
                    (isMedicare ? "Assignee" : "Responsible enroll")
                  }
                  required={requiredColumnKeys.has("responsible")}
                >
                  <EnrollmentPersonMenu
                    value={record.responsible_enroll_email}
                    peopleByEmail={peopleByEmail}
                    emptyLabel="Unassigned"
                    surface="form-field"
                    variant="assignee"
                    canEdit={capabilities.canAssignPeople}
                    onChange={(value) =>
                      void onPatch({ responsible_enroll_email: value })
                    }
                  />
                </FieldBlock>
              ) : null}

              {showCreatedBy ? (
                <FieldBlock className="order-5" label={columnByKey.get("createdBy")?.label ?? "Created by"}>
                  <div className="min-h-9 rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-2 text-sm font-medium text-[#172b4d]">
                    {personLabel(record.created_by_email, peopleByEmail)}
                  </div>
                </FieldBlock>
              ) : null}

              {showPcp2025 ? (
                <FieldBlock
                  className="order-6"
                  label={
                    columnByKey.get("pcp2025")?.label ?? (isMedicare ? "PCP" : "PCP 2025")
                  }
                  required={requiredColumnKeys.has("pcp2025")}
                >
                  <EditableInput
                    value={record.pcp_2025 ?? ""}
                    placeholder={isMedicare ? "No PCP" : "No PCP 2025"}
                    canEdit={capabilities.canEditFields}
                    className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
                    required={requiredColumnKeys.has("pcp2025")}
                    invalid={isInvalid("pcp2025")}
                    onRejectEmpty={() => markInvalid("pcp2025")}
                    onEditStart={() => clearInvalid("pcp2025")}
                    onSave={(value) => onPatch({ pcp_2025: value })}
                  />
                </FieldBlock>
              ) : null}

              {showPcp2026 ? (
                <FieldBlock
                  className="order-6"
                  label={columnByKey.get("pcp2026")?.label ?? "PCP 2026"}
                  required={requiredColumnKeys.has("pcp2026")}
                >
                  <EditableInput
                    value={record.pcp_2026 ?? ""}
                    placeholder="No PCP 2026"
                    canEdit={capabilities.canEditFields}
                    className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
                    required={requiredColumnKeys.has("pcp2026")}
                    invalid={isInvalid("pcp2026")}
                    onRejectEmpty={() => markInvalid("pcp2026")}
                    onEditStart={() => clearInvalid("pcp2026")}
                    onSave={(value) => onPatch({ pcp_2026: value })}
                  />
                </FieldBlock>
              ) : null}

              {visibleDetailColumns.map((column) => (
                <FieldBlock className="order-7" key={column.id} label={column.label} required={column.required}>
                  <EnrollmentDetailCustomFieldControl
                    column={column}
                    value={record.custom_values?.[column.key]}
                    options={optionsByColumnId.get(column.id) ?? []}
                    people={customPeople}
                    optionLabelById={optionLabelById}
                    personLabelByEmail={peopleByEmail}
                    canEdit={capabilities.canEditFields}
                    onSave={(next) =>
                      onPatch({ custom_values: { [column.key]: next } })
                    }
                  />
                </FieldBlock>
              ))}

              {showQc ? (
                <FieldBlock className="order-8" label={columnByKey.get("qc")?.label ?? "QC Review"}>
                  <EnrollmentQCPanel
                    record={record}
                    stage={stage}
                    canEdit={capabilities.canReviewQC}
                    onToggle={() => onPatch({ qc_checked: !record.qc_checked_at })}
                  />
                </FieldBlock>
              ) : null}
            </div>

            {capabilities.canReopen && stage?.is_terminal && reopenTarget ? (
              <div className="border-t border-[#dfe1e6] pt-3">
                <button
                  type="button"
                  onClick={reopen}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white text-sm font-semibold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
                >
                  Reopen to {reopenTarget.label}
                </button>
              </div>
            ) : null}

            {capabilities.canArchive && (
              <div className="border-t border-[#dfe1e6] pt-3">
                <button
                  type="button"
                  onClick={() => setConfirmArchive(true)}
                  className="text-sm font-semibold text-[#bf2600] transition hover:underline"
                >
                  Archive record
                </button>
              </div>
            )}
          </aside>
        </div>
      </div>
      </div>

      <AttachmentPreviewDialog
        preview={attachmentPreview}
        onClose={() => setAttachmentPreview(null)}
      />

      {confirmArchive ? (
        <ConfirmDialog
          title="Archive enrollment record?"
          description="The record will be hidden from the active board but retained for audit/history."
          confirmLabel="Archive"
          onCancel={() => setConfirmArchive(false)}
          onConfirm={() => {
            setConfirmArchive(false);
            void onArchive();
          }}
        />
      ) : null}

      <ReasonModal
        open={reopenReasonOpen}
        title="Reopen enrollment"
        description={
          reopenTarget
            ? `Enter a reason to reopen this record to ${reopenTarget.label}.`
            : "Enter a reason to reopen this record."
        }
        placeholder="Reason for reopening..."
        submitLabel="Reopen"
        onClose={() => setReopenReasonOpen(false)}
        onSubmit={submitReopen}
      />
    </div>
  );
}

// Maps a table_column key to the local form field it feeds — needed to check
// a Required column's value, since the form uses DB field names, not column
// keys.
const ENROLLMENT_FORM_FIELD_BY_KEY: Record<string, string> = {
  client: "client_name",
  description: "description",
  fub: "fub_link",
  due: "due_date",
  stage: "stage_id",
  carrier: "carrier_id",
  platform: "platform_id",
  consent: "consent_id",
  payment: "payment_status_id",
  aca: "aca_status_id",
  pcp2025: "pcp_2025",
  pcp2026: "pcp_2026",
  agent: "agent_email",
  caller: "caller_email",
  responsible: "responsible_enroll_email",
};

function NewEnrollmentDialog({
  program,
  peopleByEmail,
  agentsByEmail,
  optionsBySet,
  visibleColumnKeys,
  requiredColumnKeys,
  columnByKey,
  customColumns,
  tableColumnOptions,
  currentEmail,
  onClose,
  onCreate,
}: {
  program: EnrollmentProgram;
  peopleByEmail: Map<string, string>;
  agentsByEmail: Map<string, string>;
  optionsBySet: EnrollmentOptionsBySet;
  visibleColumnKeys: ReadonlySet<EnrollmentColumnKey>;
  requiredColumnKeys: ReadonlySet<string>;
  columnByKey: ReadonlyMap<string, { label: string }>;
  customColumns: readonly TableColumn[];
  tableColumnOptions: readonly TableColumnOption[];
  currentEmail: string;
  onClose: () => void;
  onCreate: (
    payload: Record<string, unknown>,
    pendingFiles: readonly PendingFile[],
  ) => Promise<void>;
}) {
  const isMedicare = program === "medicare";
  const ticketInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<Record<string, string>>({
    client_name: "",
    description: "",
    fub_link: "",
    due_date: "",
    stage_id: optionsBySet.stage[0]?.id ?? "",
    carrier_id: "",
    platform_id: "",
    consent_id: "",
    payment_status_id: "",
    aca_status_id: "",
    pcp_2025: "",
    pcp_2026: "",
    agent_email: "",
    caller_email: isMedicare ? "" : currentEmail,
    responsible_enroll_email: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidKeys, setInvalidKeys] = useState<ReadonlySet<string>>(new Set());
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const customOptionsByColumnId = useMemo(() => {
    const result = new Map<string, TableColumnOption[]>();
    for (const option of tableColumnOptions) {
      if (option.archived_at) continue;
      const list = result.get(option.column_id) ?? [];
      list.push(option);
      result.set(option.column_id, list);
    }
    return result;
  }, [tableColumnOptions]);

  useEffect(() => {
    const removedFields = findInvalidEnrollmentOptionFields(form, optionsBySet);
    if (removedFields.length === 0) return;

    const timer = window.setTimeout(() => {
      setForm((current) => {
        const next = { ...current };
        for (const field of removedFields) next[field] = "";
        return next;
      });
      setInvalidKeys((current) => new Set([...current, ...removedFields]));
      setError("An option used by this form was archived. Please choose a replacement.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [form, optionsBySet]);

  useEffect(() => {
    ticketInputRef.current?.focus();
  }, []);

  const showField = (key: EnrollmentColumnKey) => visibleColumnKeys.has(key);
  const showFub = showField("fub");
  const showStage = showField("stage");
  const showDue = showField("due");
  const showPayment = !isMedicare && showField("payment");
  const showCarrier = showField("carrier");
  const showAca = !isMedicare && showField("aca");
  const showConsent = !isMedicare && showField("consent");
  const showPlatform = !isMedicare && showField("platform");
  const showAgent = showField("agent");
  const showCaller = !isMedicare && showField("caller");
  const showResponsible = showField("responsible");
  const showPcp2025 = showField("pcp2025");
  const showPcp2026 = !isMedicare && showField("pcp2026");
  const initialStage = optionsBySet.stage[0] ?? null;
  const initialStageStyle = enrollmentStateBadgeStyle(initialStage);
  const showPipelineSection = showStage || showDue;
  const showPlanSection =
    showPayment || showCarrier || showAca || showConsent || showPlatform;
  const showOwnershipSection = showAgent || showCaller || showResponsible;
  const showPcpSection = showPcp2025 || showPcp2026;

  function isFilled(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    return String(value).trim() !== "";
  }
  function isInvalid(key: string): boolean {
    const formField = ENROLLMENT_FORM_FIELD_BY_KEY[key];
    const value =
      key === "stage"
        ? form.stage_id || initialStage?.id || ""
        : formField
          ? form[formField]
          : customValues[key];
    return (
      invalidKeys.has(key) &&
      !isFilled(value)
    );
  }

  function update(field: string, value: string | null) {
    setForm((current) => ({ ...current, [field]: value ?? "" }));
  }

  function updateCustom(key: string, value: unknown) {
    setCustomValues((current) => ({ ...current, [key]: value }));
    setInvalidKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  async function submit() {
    const missing = [...requiredColumnKeys].filter((key) => {
      const formField = ENROLLMENT_FORM_FIELD_BY_KEY[key];
      const value =
        key === "stage"
          ? form.stage_id || initialStage?.id || ""
          : formField
            ? form[formField]
            : customValues[key];
      return !isFilled(value);
    });
    if (missing.length > 0) {
      setInvalidKeys(new Set(missing));
      setError(`Please complete the required fields: ${missing.join(", ")}.`);
      window.setTimeout(() => {
        const firstInvalid = document.querySelector<HTMLElement>(
          '[data-enrollment-invalid="true"] input, [data-enrollment-invalid="true"] textarea, [data-enrollment-invalid="true"] button'
        );
        firstInvalid?.scrollIntoView({ block: "center", behavior: "smooth" });
        firstInvalid?.focus();
      }, 0);
      return;
    }
    setInvalidKeys(new Set());
    setSaving(true);
    setError(null);
    try {
      // Medicare has no Payment/Consent/Platform/AC/Caller/PCP-2026 concepts
      // — don't rely on the form fields being hidden in the UI to keep them
      // out of the record; strip them from the payload explicitly so a
      // record can never end up with Medicare-inapplicable data.
      const payload = isMedicare
        ? {
            ...form,
            caller_email: "",
            payment_status_id: "",
            aca_status_id: "",
            consent_id: "",
            platform_id: "",
            pcp_2026: "",
            custom_values: customValues,
          }
        : { ...form, custom_values: customValues };
      await onCreate(
        {
          ...payload,
          stage_id: form.stage_id || initialStage?.id || "",
        },
        pendingFiles,
      );
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create record.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6">
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]">
        <header className="shrink-0 border-b border-[#dfe1e6] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-[#172b4d]">New enrollment</h2>
              <p className="mt-1 text-sm text-[#626f86]">
                Capture the client first, then set ownership and enrollment details.
              </p>
              {error ? (
                <p role="alert" className="mt-2 text-sm font-semibold text-[#bf2600]">
                  {error}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_320px]">
            <main className="min-w-0 space-y-3 px-6 py-5">
              <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className="block text-xs font-bold uppercase text-[#6b778c]">
                  {columnByKey.get("client")?.label ?? "Client Name"}
                  {requiredColumnKeys.has("client") ? REQUIRED_MARK : null}
                </span>
                <input
                  ref={ticketInputRef}
                  value={form.client_name}
                  onChange={(event) => update("client_name", event.target.value)}
                  placeholder="Client name"
                  className={`${COMPACT_DETAIL_INPUT_CLASS} ${isInvalid("client") ? INVALID_RING_CLASS : ""}`}
                />
              </label>

              {showFub ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>
                    {columnByKey.get("fub")?.label ?? "FUB Link"}
                    {requiredColumnKeys.has("fub") ? REQUIRED_MARK : null}
                  </span>
                  <input
                    value={form.fub_link}
                    onChange={(event) => update("fub_link", event.target.value)}
                    placeholder="https://app.followupboss.com/..."
                    className={`${COMPACT_DETAIL_INPUT_CLASS} ${isInvalid("fub") ? INVALID_RING_CLASS : ""}`}
                  />
                </label>
              ) : null}

              <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className="block text-xs font-bold uppercase text-[#6b778c]">
                  {columnByKey.get("description")?.label ?? "Description"}
                  {requiredColumnKeys.has("description") ? REQUIRED_MARK : null}
                </span>
                <textarea
                  value={form.description}
                  onChange={(event) => update("description", event.target.value)}
                  placeholder="Add context, notes, missing items, or next steps..."
                  rows={13}
                  className={`${CREATE_DESCRIPTION_CLASS} ${isInvalid("description") ? INVALID_RING_CLASS : ""}`}
                />
              </label>

              <div className="space-y-1">
                <span className="block text-xs font-bold uppercase text-[#6b778c]">
                  Attachments
                </span>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
                    className="hidden"
                    onChange={(event) => {
                      const incoming = [...(event.target.files ?? [])];
                      const result = addPendingFiles(pendingFiles, incoming);
                      if (!result.ok) setFileError(result.message);
                      else {
                        setPendingFiles(result.files);
                        setFileError(null);
                      }
                      event.currentTarget.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                    className="inline-flex h-9 items-center gap-1.5 rounded border-2 border-dashed border-[#85b8ff] px-3 text-sm font-semibold text-[#0c66e4] transition hover:bg-[#e9f2ff] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Paperclip className="h-4 w-4" />
                    Add files
                  </button>
                </div>
                {pendingFiles.length > 0 ? (
                  <ul className="flex max-h-[58px] flex-wrap gap-1.5 overflow-y-auto pt-1">
                    {pendingFiles.map((file) => (
                      <li
                        key={file.key}
                        className="inline-flex max-w-[16rem] items-center gap-1 rounded bg-[#f4f5f7] px-2 py-1 text-xs text-[#42526e]"
                      >
                        <span className="truncate" title={file.name}>{file.name}</span>
                        <span className="shrink-0 text-[#7a869a]">{formatAttachmentSize(file.size)}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          disabled={saving}
                          onClick={() => setPendingFiles((current) => removePendingFile(current, file.key))}
                          className="shrink-0 rounded p-0.5 hover:bg-[#dfe1e6] disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {fileError ? (
                  <p role="alert" className="text-xs font-semibold text-[#bf2600]">
                    {fileError}
                  </p>
                ) : null}
              </div>

              {error ? (
                <div className="rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-bold text-[#bf2600]">
                  {error}
                </div>
              ) : null}
            </main>

            <aside className="min-w-0 flex flex-col gap-4 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0">
              {showPipelineSection ? (
                <CreatePropertySection className="order-2 !border-t !pt-4">
                  {showStage ? (
                    <CreatePropertyField
                      label={columnByKey.get("stage")?.label ?? "Stage"}
                      required={requiredColumnKeys.has("stage")}
                      invalid={isInvalid("stage")}
                    >
                      <div
                        className="flex h-9 w-full min-w-0 items-center gap-2 px-0 py-1 text-left text-sm font-semibold text-[#172b4d]"
                        title="New records always start at the first stage. Change it from the record after creating."
                      >
                        <span
                          className="inline-flex max-w-full min-w-0 items-center rounded px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-wide"
                          style={{
                            backgroundColor: initialStageStyle.bg,
                            color: initialStageStyle.fg,
                          }}
                        >
                          <span className="truncate">
                            {initialStage?.label ?? "No stage"}
                          </span>
                        </span>
                      </div>
                    </CreatePropertyField>
                  ) : null}

                  {showDue ? (
                    <CreatePropertyInput
                      label={columnByKey.get("due")?.label ?? "Due date"}
                      type="date"
                      value={form.due_date}
                      required={requiredColumnKeys.has("due")}
                      invalid={isInvalid("due")}
                      onChange={(value) => update("due_date", value)}
                    />
                  ) : null}
                </CreatePropertySection>
              ) : null}

              {showPlanSection ? (
                <CreatePropertySection className="order-3 !border-t !pt-4">
                  {showPayment ? (
                    <CreatePropertyField
                      label={columnByKey.get("payment")?.label ?? "Payment"}
                      required={requiredColumnKeys.has("payment")}
                      invalid={isInvalid("payment")}
                    >
                      <EnrollmentOptionMenu
                        optionId={form.payment_status_id || null}
                        options={optionsBySet.payment_status}
                        emptyLabel="No payment"
                        placeholderLabel="Select payment"
                        surface="form-bare"
                        onChange={(value) => update("payment_status_id", value)}
                      />
                    </CreatePropertyField>
                  ) : null}

                  {showCarrier ? (
                    <CreatePropertyField
                      label={columnByKey.get("carrier")?.label ?? "Carrier"}
                      required={requiredColumnKeys.has("carrier")}
                      invalid={isInvalid("carrier")}
                    >
                      <EnrollmentOptionMenu
                        optionId={form.carrier_id || null}
                        options={optionsBySet.carrier}
                        emptyLabel="No carrier"
                        placeholderLabel="Select carrier"
                        surface="form-bare"
                        onChange={(value) => update("carrier_id", value)}
                      />
                    </CreatePropertyField>
                  ) : null}

                  {showAca ? (
                    <CreatePropertyField
                      label={columnByKey.get("aca")?.label ?? "AC"}
                      required={requiredColumnKeys.has("aca")}
                      invalid={isInvalid("aca")}
                    >
                      <EnrollmentOptionMenu
                        optionId={form.aca_status_id || null}
                        options={optionsBySet.aca_status}
                        emptyLabel="No ACA status"
                        placeholderLabel="Select ACA status"
                        surface="form-bare"
                        onChange={(value) => update("aca_status_id", value)}
                      />
                    </CreatePropertyField>
                  ) : null}

                  {showConsent ? (
                    <CreatePropertyField
                      label={columnByKey.get("consent")?.label ?? "Consent"}
                      required={requiredColumnKeys.has("consent")}
                      invalid={isInvalid("consent")}
                    >
                      <EnrollmentConsentToggle
                        optionId={form.consent_id || null}
                        options={optionsBySet.consent}
                        onChange={(value) => update("consent_id", value)}
                      />
                    </CreatePropertyField>
                  ) : null}

                  {showPlatform ? (
                    <CreatePropertyField
                      label={columnByKey.get("platform")?.label ?? "Platform"}
                      required={requiredColumnKeys.has("platform")}
                      invalid={isInvalid("platform")}
                    >
                      <EnrollmentOptionMenu
                        optionId={form.platform_id || null}
                        options={optionsBySet.platform}
                        emptyLabel="No platform"
                        placeholderLabel="Select platform"
                        surface="form-bare"
                        onChange={(value) => update("platform_id", value)}
                      />
                    </CreatePropertyField>
                  ) : null}
                </CreatePropertySection>
              ) : null}

              {showOwnershipSection ? (
                <CreatePropertySection className="order-1 !border-t-0 !pt-0">
                  {showAgent ? (
                    <CreatePropertyField
                      label={columnByKey.get("agent")?.label ?? "Agent"}
                      required={requiredColumnKeys.has("agent")}
                      invalid={isInvalid("agent")}
                    >
                      <EnrollmentPersonMenu
                        value={form.agent_email || null}
                        peopleByEmail={agentsByEmail}
                        emptyLabel="Unassigned"
                        placeholderLabel="Agent"
                        surface="form-bare"
                        variant="assignee"
                        onChange={(value) => update("agent_email", value)}
                      />
                    </CreatePropertyField>
                  ) : null}

                  {showCaller ? (
                    <CreatePropertyField
                      label={columnByKey.get("caller")?.label ?? "Caller"}
                      required={requiredColumnKeys.has("caller")}
                      invalid={isInvalid("caller")}
                    >
                      <EnrollmentPersonMenu
                        value={form.caller_email || null}
                        peopleByEmail={peopleByEmail}
                        emptyLabel="Unassigned"
                        placeholderLabel="Caller"
                        surface="form-bare"
                        variant="assignee"
                        onChange={(value) => update("caller_email", value)}
                      />
                    </CreatePropertyField>
                  ) : null}

                  {showResponsible ? (
                    <CreatePropertyField
                      label={
                        columnByKey.get("responsible")?.label ??
                        (isMedicare ? "Assignee" : "Responsible enroll")
                      }
                      required={requiredColumnKeys.has("responsible")}
                      invalid={isInvalid("responsible")}
                    >
                      <EnrollmentPersonMenu
                        value={form.responsible_enroll_email || null}
                        peopleByEmail={peopleByEmail}
                        emptyLabel="Unassigned"
                        surface="form-bare"
                        variant="assignee"
                        onChange={(value) => update("responsible_enroll_email", value)}
                      />
                    </CreatePropertyField>
                  ) : null}
                </CreatePropertySection>
              ) : null}

              {showPcpSection ? (
                <CreatePropertySection className="order-4 !border-t !pt-4">
                  {showPcp2025 ? (
                    <CreatePropertyInput
                      label={
                        columnByKey.get("pcp2025")?.label ?? (isMedicare ? "PCP" : "PCP 2025")
                      }
                      value={form.pcp_2025}
                      placeholder={isMedicare ? "No PCP" : "No PCP 2025"}
                      required={requiredColumnKeys.has("pcp2025")}
                      invalid={isInvalid("pcp2025")}
                      onChange={(value) => update("pcp_2025", value)}
                    />
                  ) : null}

                  {showPcp2026 ? (
                    <CreatePropertyInput
                      label={columnByKey.get("pcp2026")?.label ?? "PCP 2026"}
                      value={form.pcp_2026}
                      placeholder="No PCP 2026"
                      required={requiredColumnKeys.has("pcp2026")}
                      invalid={isInvalid("pcp2026")}
                      onChange={(value) => update("pcp_2026", value)}
                    />
                  ) : null}
                </CreatePropertySection>
              ) : null}

              {customColumns.length > 0 ? (
                <CreatePropertySection className="order-5 !border-t !pt-4">
                  {customColumns.map((column) => (
                    <CreateEnrollmentCustomField
                      key={column.id}
                      column={column}
                      value={customValues[column.key]}
                      options={customOptionsByColumnId.get(column.id) ?? []}
                      peopleByEmail={peopleByEmail}
                      required={requiredColumnKeys.has(column.key)}
                      invalid={isInvalid(column.key)}
                      onChange={(value) => updateCustom(column.key, value)}
                    />
                  ))}
                </CreatePropertySection>
              ) : null}
            </aside>
          </div>
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#dfe1e6] bg-white px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function CreateEnrollmentCustomField({
  column,
  value,
  options,
  peopleByEmail,
  required,
  invalid,
  onChange,
}: {
  column: TableColumn;
  value: unknown;
  options: readonly TableColumnOption[];
  peopleByEmail: Map<string, string>;
  required: boolean;
  invalid: boolean;
  onChange: (value: unknown) => void;
}) {
  const label = column.label;

  if (column.type === "dropdown") {
    return (
      <CreatePropertyField label={label} required={required} invalid={invalid}>
        <CreateEnrollmentOptionMenu
          value={typeof value === "string" ? value : null}
          options={options}
          placeholder={`Select ${label.toLowerCase()}`}
          onChange={onChange}
        />
      </CreatePropertyField>
    );
  }

  if (column.type === "person") {
    return (
      <CreatePropertyField label={label} required={required} invalid={invalid}>
        <EnrollmentPersonMenu
          value={typeof value === "string" ? value : null}
          peopleByEmail={peopleByEmail}
          emptyLabel="Unassigned"
          placeholderLabel={`Select ${label.toLowerCase()}`}
          surface="form-bare"
          variant="assignee"
          onChange={onChange}
        />
      </CreatePropertyField>
    );
  }

  if (column.type === "checkbox") {
    return (
      <CreatePropertyField label={label} required={required} invalid={invalid}>
        <ControlledCustomField column={column} value={value} invalid={invalid} onChange={onChange} />
      </CreatePropertyField>
    );
  }
  return (
    <CreatePropertyField label={label} required={required} invalid={invalid}>
      <ControlledCustomField column={column} value={value} invalid={invalid} onChange={onChange} />
    </CreatePropertyField>
  );
}

function CreateEnrollmentOptionMenu({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string | null;
  options: readonly TableColumnOption[];
  placeholder: string;
  onChange: (value: string | null) => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, closeMenu, closeMenuForTab } = useAnchoredMenu();
  const selected = value ? options.find((option) => option.id === value) ?? null : null;
  return (
    <span className="block min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex w-full min-w-0 items-center gap-2 text-left"
      >
        <span className={`min-w-0 flex-1 truncate text-sm ${selected ? "font-semibold text-[#172b4d]" : "font-normal text-[#97a0af]"}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {isOpen
        ? createPortal(
            <SearchableListboxPanel
              menuRef={menuRef}
              menuStyle={menuStyle}
              ariaLabel={placeholder}
              queryPlaceholder={`Search ${placeholder.toLowerCase()}…`}
              emptyMessage="No matching options."
              choices={options.map((option) => ({ value: option.id, label: option.label }))}
              selectedValue={value}
              onSelect={(next) => {
                onChange(next);
                closeMenu({ restoreFocus: true });
              }}
              onTabExit={closeMenuForTab}
            />,
            document.body
          )
        : null}
    </span>
  );
}

function EditableInput({
  value,
  placeholder,
  className = `${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`,
  canEdit = true,
  required,
  invalid,
  onRejectEmpty,
  onEditStart,
  onSave,
}: {
  value: string;
  placeholder: string;
  className?: string;
  canEdit?: boolean;
  required?: boolean;
  invalid?: boolean;
  onRejectEmpty?: () => void;
  onEditStart?: () => void;
  onSave: (value: string | null) => Promise<void>;
}) {
  // revertNonce forces a remount (fresh defaultValue) when a required field
  // gets blurred empty — the input is uncontrolled, so without this the DOM
  // would keep showing what the user typed even though we refuse to save it.
  const [revertNonce, setRevertNonce] = useState(0);
  return (
    <input
      key={`${value}-${revertNonce}`}
      defaultValue={value}
      placeholder={placeholder}
      disabled={!canEdit}
      onClick={(event) => event.stopPropagation()}
      onFocus={() => onEditStart?.()}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (required && !next) {
          setRevertNonce((n) => n + 1);
          onRejectEmpty?.();
          return;
        }
        if (next !== value.trim()) void onSave(next || null);
      }}
      className={`${className} ${invalid ? INVALID_RING_CLASS : ""} disabled:cursor-not-allowed disabled:bg-[#f4f5f7]`}
    />
  );
}

function EditableTextarea({
  value,
  placeholder,
  className = COMPACT_DESCRIPTION_CLASS,
  canEdit = true,
  onSave,
}: {
  value: string;
  placeholder: string;
  className?: string;
  canEdit?: boolean;
  onSave: (value: string | null) => Promise<void>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    const textarea = textareaRef.current;
    const measuredHeight = autosizeTextarea(textarea);
    setContentHeight(measuredHeight);
    if (!expanded && textarea) {
      textarea.style.height = "72px";
      textarea.style.overflowY = "hidden";
    }
  }, [expanded, value]);

  return (
    <div className="space-y-1">
      {contentHeight > 72 ? (
        <div className="flex justify-end">
          <button
            type="button"
            aria-expanded={expanded}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setExpanded((current) => !current)}
            className="rounded px-1 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#0c66e4] transition hover:bg-[#e9f2ff]"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        disabled={!canEdit}
        onFocus={() => setExpanded(true)}
        onClick={(event) => event.stopPropagation()}
        onInput={(event) => {
          setContentHeight(autosizeTextarea(event.currentTarget));
        }}
        onBlur={(event) => {
          setExpanded(false);
          const next = event.currentTarget.value.trim();
          if (next !== value.trim()) void onSave(next || null);
        }}
        rows={2}
        className={`${className} disabled:cursor-not-allowed disabled:bg-[#f4f5f7]`}
      />
    </div>
  );
}

function EnrollmentDetailCustomFieldControl({
  column,
  value,
  options,
  people,
  optionLabelById,
  personLabelByEmail,
  canEdit,
  onSave,
}: {
  column: TableColumn;
  value: unknown;
  options: readonly TableColumnOption[];
  people: readonly { email: string; name: string | null }[];
  optionLabelById: ReadonlyMap<string, string>;
  personLabelByEmail: ReadonlyMap<string, string>;
  canEdit: boolean;
  onSave: (next: unknown) => Promise<void>;
}) {
  const [saveError, setSaveError] = useState(false);

  if (column.type === "checkbox") {
    const checked = Boolean(value);
    return (
      <button
        type="button"
        disabled={!canEdit}
        aria-pressed={checked}
        onClick={async () => {
          setSaveError(false);
          try {
            await onSave(!checked);
          } catch {
            setSaveError(true);
          }
        }}
        className={`${DETAIL_FIELD_BUTTON_CLASS} ${
          saveError ? "ring-2 ring-[#ff5630] ring-offset-1" : ""
        } disabled:cursor-not-allowed disabled:bg-[#f4f5f7]`}
        title={saveError ? "Save failed. Try again." : column.label}
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
            checked
              ? "border-[#00875a] bg-[#00875a] text-white"
              : "border-[#c1c7d0] text-transparent"
          }`}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
        <span>{checked ? "Yes" : "No"}</span>
      </button>
    );
  }

  return (
    <EditableCustomCell
      column={column}
      value={value}
      options={options}
      people={people}
      optionLabelById={optionLabelById}
      personLabelByEmail={personLabelByEmail}
      canEdit={canEdit}
      onSave={onSave}
      className={`${DETAIL_FIELD_DISPLAY_CLASS} ${column.type === "date" ? "!font-medium !text-[#42526e]" : ""}`}
      inputClassName={`${DETAIL_FIELD_INPUT_CLASS} ${column.type === "date" ? "!font-medium !text-[#42526e]" : ""}`}
      emptyLabel={`No ${column.label}`}
    />
  );
}

function EnrollmentQCPanel({
  record,
  stage,
  canEdit = true,
  onToggle,
}: {
  record: EnrollmentRecordWithStats;
  stage: EnrollmentOption | null;
  canEdit?: boolean;
  onToggle: () => Promise<void>;
}) {
  const reviewed = Boolean(record.qc_checked_at);
  const required = Boolean(stage?.triggers_qc);
  const label = reviewed
    ? "QC checked"
    : required
      ? "Needs QC"
      : "No QC required";

  return (
    <button
      type="button"
      disabled={!required || !canEdit}
      aria-pressed={reviewed}
      aria-label={reviewed ? "Clear QC check" : "Mark QC checked"}
      onClick={() => void onToggle()}
      className="flex h-9 w-full items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 text-left text-sm font-semibold text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:bg-[#f4f5f7]"
    >
      <span
        className={`shrink-0 ${
          reviewed
            ? "text-[#00875a]"
            : required
              ? "text-[#ff991f]"
              : "text-[#97a0af]"
        }`}
      >
        {reviewed ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <Circle className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-1/3 animate-pulse rounded bg-[#f1f2f4]" />
      <div className="h-16 w-full animate-pulse rounded bg-[#f1f2f4]" />
      <div className="h-16 w-5/6 animate-pulse rounded bg-[#f1f2f4]" />
    </div>
  );
}

function DrawerTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group -mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-semibold transition ${
        active
          ? "border-[#0c66e4] text-[#0c66e4]"
          : "border-transparent text-[#5e6c84] hover:border-[#c1c7d0] hover:text-[#172b4d]"
      }`}
    >
      {label}
      {typeof count === "number" ? (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition ${
            active
              ? "bg-[#e9f2ff] text-[#0c66e4]"
              : "bg-[#f1f2f4] text-[#626f86] group-hover:bg-[#dfe1e6]"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function FieldBlock({
  label,
  required,
  invalid,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  invalid?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`space-y-1.5 ${className}`}
      data-enrollment-invalid={invalid ? "true" : undefined}
    >
      <span className={LABEL_CLASS}>
        {label}
        {required ? REQUIRED_MARK : null}
      </span>
      <div className={invalid ? `${INVALID_RING_CLASS} rounded-lg` : undefined}>
        {children}
      </div>
    </div>
  );
}

function CreatePropertySection({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-3 border-t border-[#dfe1e6] pt-4 first:border-t-0 first:pt-0 ${className}`}>
      {children}
    </section>
  );
}

function CreatePropertyField({
  label,
  required,
  invalid,
  children,
}: {
  label: string;
  required?: boolean;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="space-y-1.5"
      data-enrollment-invalid={invalid ? "true" : undefined}
    >
      <span className={LABEL_CLASS}>
        {label}
        {required ? REQUIRED_MARK : null}
      </span>
      <div
        className={`flex min-h-10 items-center rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1 text-sm font-semibold text-[#172b4d] transition hover:border-[#c1c7d0] focus-within:border-[#0c66e4] focus-within:ring-2 focus-within:ring-[#deebff] ${invalid ? INVALID_RING_CLASS : ""}`}
      >
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function CreatePropertyInput({
  label,
  value,
  type = "text",
  placeholder,
  required,
  invalid,
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <CreatePropertyField
      label={type === "date" ? `${label} (month/day/year)` : label}
      required={required}
      invalid={invalid}
    >
      <input
        type={type}
        value={value}
        placeholder={placeholder ?? (type === "date" ? "month/day/year" : undefined)}
        onChange={(event) => onChange(event.target.value)}
        className={`h-7 w-full min-w-0 bg-transparent px-0 text-sm outline-none placeholder:text-[#97a0af] ${type === "date" ? "font-medium text-[#42526e]" : "font-semibold text-[#172b4d]"}`}
      />
    </CreatePropertyField>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#091e42]/50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl">
        <h2 className="text-lg font-bold text-[#172b4d]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[#5e6c84]">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-2 text-sm font-bold text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-[#ca3521] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#ae2a19]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function filterRecords(
  records: EnrollmentRecordWithStats[],
  filters: Filters,
  optionsById: Map<string, EnrollmentOption>,
  currentEmail: string
) {
  const query = filters.query.trim().toLowerCase();
  const normalizedCurrentEmail = normalizeEnrollmentEmail(currentEmail);
  return records.filter((record) => {
    const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
    if (filters.attention && !enrollmentNeedsAttention(record, optionsById)) return false;
    if (filters.qcNeeded && !(stage?.triggers_qc && !record.qc_checked_at)) return false;
    const hasCaller = record.program === "medicare" || Boolean(record.caller_email);
    if (filters.unowned && hasCaller && record.responsible_enroll_email) {
      return false;
    }
    if (filters.stage.length > 0 && !filters.stage.includes(record.stage_id ?? "")) return false;
    if (filters.agent.length > 0 && !filters.agent.includes(record.agent_email ?? "")) return false;
    if (filters.caller.length > 0 && !filters.caller.includes(record.caller_email ?? "")) return false;
    if (
      filters.mineOnly &&
      ![
        record.created_by_email,
        record.caller_email,
        record.responsible_enroll_email,
      ].some((email) => normalizeEnrollmentEmail(email) === normalizedCurrentEmail)
    ) {
      return false;
    }
    if (
      !filters.mineOnly &&
      filters.responsible.length > 0 &&
      !filters.responsible.includes(record.responsible_enroll_email ?? "")
    ) {
      return false;
    }
    if (filters.carrier.length > 0 && !filters.carrier.includes(record.carrier_id ?? "")) return false;
    const createdDate = record.created_at.slice(0, 10);
    if (filters.createdFrom && createdDate < filters.createdFrom) return false;
    if (filters.createdTo && createdDate > filters.createdTo) return false;
    if (!query) return true;

    return buildEnrollmentSearchHaystack(record).includes(query);
  });
}

function sortRecords(
  records: EnrollmentRecordWithStats[],
  sort: { key: SortKey; dir: SortDir },
  optionsById: Map<string, EnrollmentOption>,
  peopleByEmail: Map<string, string>
) {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...records].sort((a, b) => {
    const av = sortValue(a, sort.key, optionsById, peopleByEmail);
    const bv = sortValue(b, sort.key, optionsById, peopleByEmail);
    if (av === bv) return b.updated_at.localeCompare(a.updated_at);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "string" && typeof bv === "string") {
      return compareEnrollmentOptionText(av, bv) * factor;
    }
    return av < bv ? -1 * factor : factor;
  });
}

function sortValue(
  record: EnrollmentRecordWithStats,
  key: SortKey,
  optionsById: Map<string, EnrollmentOption>,
  peopleByEmail: Map<string, string>
): string | number | null {
  switch (key) {
    case "key":
      return enrollmentDisplayKey(record.display_number, record.program);
    case "attention":
      return enrollmentAttentionScore(record, optionsById);
    case "client":
      return record.client_name?.toLowerCase() ?? null;
    case "stage":
      return record.stage_id ? optionsById.get(record.stage_id)?.label ?? null : null;
    case "caller":
      return record.caller_email
        ? personLabel(record.caller_email, peopleByEmail).toLowerCase()
        : null;
    case "responsible":
      return record.responsible_enroll_email
        ? personLabel(record.responsible_enroll_email, peopleByEmail).toLowerCase()
        : null;
    case "payment":
      return record.payment_status_id
        ? optionLabel(record.payment_status_id, optionsById).toLowerCase()
        : null;
    case "carrier":
      return record.carrier_id
        ? optionLabel(record.carrier_id, optionsById).toLowerCase()
        : null;
    case "aca":
      return record.aca_status_id
        ? optionLabel(record.aca_status_id, optionsById).toLowerCase()
        : null;
    case "consent":
      return record.consent_id
        ? optionLabel(record.consent_id, optionsById).toLowerCase()
        : null;
    case "platform":
      return record.platform_id
        ? optionLabel(record.platform_id, optionsById).toLowerCase()
        : null;
    case "pcp2025":
      return record.pcp_2025?.toLowerCase() ?? null;
    case "pcp2026":
      return record.pcp_2026?.toLowerCase() ?? null;
    case "due":
      return record.due_date;
    case "comments":
      return record.comment_count + record.attachment_count;
    case "qc": {
      const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
      if (!stage?.triggers_qc) return 0;
      return record.qc_checked_at ? 1 : 2;
    }
    case "createdBy":
      return personLabel(record.created_by_email, peopleByEmail).toLowerCase();
    case "createdAt":
      return record.created_at;
    case "updatedBy":
      return record.updated_by_email
        ? personLabel(record.updated_by_email, peopleByEmail).toLowerCase()
        : null;
    case "updated":
      return record.updated_at;
  }
}

function enrollmentNeedsAttention(
  record: EnrollmentRecordWithStats,
  optionsById: Map<string, EnrollmentOption>
): boolean {
  const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
  if (record.closed_at) return Boolean(stage?.triggers_qc && !record.qc_checked_at);
  // Medicare has no Caller role (always null by design) — only ACA should
  // treat a missing caller as a real "nobody owns this" signal.
  const missingCaller = record.program !== "medicare" && !record.caller_email;
  return (
    Boolean(stage?.triggers_qc && !record.qc_checked_at) ||
    missingCaller ||
    !record.responsible_enroll_email ||
    !record.due_date
  );
}

function enrollmentAttentionScore(
  record: EnrollmentRecordWithStats,
  optionsById: Map<string, EnrollmentOption>
): number {
  const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
  if (record.closed_at && !(stage?.triggers_qc && !record.qc_checked_at)) return 0;

  let score = 0;
  if (stage?.triggers_qc && !record.qc_checked_at) score += 700;
  if (!record.responsible_enroll_email) score += 500;
  if (record.program !== "medicare" && !record.caller_email) score += 400;
  if (!record.due_date) score += 300;
  return score;
}

function groupOptions(options: EnrollmentOption[]): EnrollmentOptionsBySet {
  const bySet = emptyEnrollmentOptionsBySet();
  for (const option of options) {
    if (!option.archived_at) bySet[option.set_key].push(option);
  }
  for (const key of Object.keys(bySet) as EnrollmentOptionSetKey[]) {
    bySet[key] = sortEnrollmentOptionsByLabel(bySet[key]);
  }
  return bySet;
}

function selectOptions(options: EnrollmentOption[]) {
  return options.map((option) => ({ value: option.id, label: option.label }));
}

function peopleOptions(people: EnrollmentPerson[]) {
  return people.map((person) => ({
    value: person.email,
    label: person.name?.trim() || formatEmailAsName(person.email),
  }));
}

function agentOptions(agents: TaskAgent[]) {
  return agents.map((agent) => ({
    value: agent.email,
    label: agent.name?.trim() || formatEmailAsName(agent.email),
  }));
}

function getReopenStage(
  stage: EnrollmentOption | null,
  stages: EnrollmentOption[]
): EnrollmentOption | null {
  const orderedStages = sortEnrollmentOptionsByLabel(stages);
  const candidates = orderedStages.filter((option) => !option.is_terminal);
  if (!stage) return candidates[0] ?? null;

  const stageIndex = orderedStages.findIndex((option) => option.id === stage.id);
  if (stageIndex > 0) {
    const previousOpenStage = orderedStages
      .slice(0, stageIndex)
      .reverse()
      .find((option) => !option.is_terminal);
    if (previousOpenStage) return previousOpenStage;
  }

  return candidates[0] ?? null;
}

function formatExternalLink(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function RelativeTime({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const firstTick = window.setTimeout(() => setNowMs(Date.now()), 0);
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <span className={className} title={formatStableDateTime(value)}>
      {nowMs === null ? formatStableDateTime(value) : formatRelative(value, nowMs)}
    </span>
  );
}

function formatRelative(value: string, nowMs: number): string {
  const date = new Date(value);
  const diffMs = nowMs - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return "just now";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatStableDate(value);
}

function formatStableDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return `${formatStableDate(value)} ${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes()
  ).padStart(2, "0")} UTC`;
}

function formatStableDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

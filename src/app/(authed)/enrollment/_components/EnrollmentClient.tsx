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
  Plus,
  Search,
  Settings2,
  UserPlus,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import {
  OPEN_ENROLLMENT_EVENT,
  writeEnrollmentDeepLink,
} from "@/lib/enrollment/client-events";
import {
  ENROLLMENT_TOPIC,
  enrollmentRoomTopic,
} from "@/lib/enrollment/realtime-topics";
import {
  enrollmentKey,
  formatDateInput,
  optionLabel,
} from "@/lib/enrollment/helpers";
import { buildEnrollmentSearchHaystack } from "@/lib/enrollment/filtering";
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
import { Toast } from "../../_shared/Toast";
import { CommentThread } from "../../tasks/_components/CommentThread";
import { ActivityFeed } from "../../tasks/_components/ActivityFeed";
import { AttachmentPanel } from "../../tasks/_components/AttachmentPanel";
import { TaskSelect } from "../../tasks/_components/TaskSelect";
import { DateRangeFilter } from "../../tasks/_components/TaskToolbar";
import { ReasonModal } from "../../tasks/_components/ReasonModal";
import { useAnchoredMenu } from "../../tasks/_components/use-anchored-menu";
import { Initials } from "../../tasks/_components/board-ui";
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
  payment: string[];
  attention: boolean;
  qcNeeded: boolean;
  unowned: boolean;
  createdFrom: string;
  createdTo: string;
};

type PendingEnrollmentPatch = {
  sequence: number;
  patch: Record<string, unknown>;
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
  payment: [],
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
const COMPACT_DESCRIPTION_CLASS = `${INPUT_CLASS} min-h-[72px] resize-none overflow-hidden !px-2 !py-2 leading-6`;
const CREATE_DESCRIPTION_CLASS =
  "min-h-[21rem] w-full resize-none rounded border-2 border-[#dfe1e6] bg-white px-3 py-3 text-sm leading-6 text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
const INVALID_RING_CLASS = "!ring-2 !ring-[#ff5630] !ring-offset-1";
const REQUIRED_MARK = <span className="text-[#bf2600]"> *</span>;

function autosizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(72, textarea.scrollHeight)}px`;
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
  { key: "fub", label: "FUB Link", width: 84, align: "center" },
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

function canEditEnrollmentRecordClient(
  record: Pick<
    EnrollmentRecordWithStats,
    "caller_email" | "responsible_enroll_email" | "created_by_email"
  >,
  currentEmail: string,
  isManager: boolean
): boolean {
  if (isManager) return true;
  const normalized = normalizeEnrollmentEmail(currentEmail);
  if (!normalized) return false;
  return [
    record.caller_email,
    record.responsible_enroll_email,
    record.created_by_email,
  ].some((email) => normalizeEnrollmentEmail(email) === normalized);
}

function normalizeEnrollmentEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

// Narrower than canEditEnrollmentRecordClient on purpose — mirrors the
// server's canArchiveEnrollmentRecord() (lib/enrollment/access.ts): manager
// or the record's original creator only, not every stakeholder who can edit.
function canArchiveEnrollmentRecordClient(
  record: Pick<EnrollmentRecordWithStats, "created_by_email">,
  currentEmail: string,
  isManager: boolean
): boolean {
  if (isManager) return true;
  const normalized = normalizeEnrollmentEmail(currentEmail);
  if (!normalized) return false;
  return normalizeEnrollmentEmail(record.created_by_email) === normalized;
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
  canManageOptions: boolean;
  canExport: boolean;
}) {
  const [records, setRecords] = useState(initialRecords);
  const [options, setOptions] = useState(initialOptions);
  const [view, setView] = useState<"list" | "overview">("list");
  const [filters, setFilters] = useState<Filters>(() =>
    canManageOptions
      ? DEFAULT_FILTERS
      : { ...DEFAULT_FILTERS, responsible: [currentEmail], mineOnly: true }
  );
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "attention",
    dir: "desc",
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [layoutTableColumns, setLayoutTableColumns] = useState<TableColumn[]>(tableColumns);
  const [error, setError] = useState<string | null>(null);
  const recordRowsRef = useRef(new Map(initialRecords.map((record) => [record.id, record])));
  const recordMutationStatesRef = useRef(new Map<string, EnrollmentMutationState>());
  const pendingRef = useRef(new Map<string, number>());
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
  // Lets refetch re-run itself without a self-referencing useCallback.
  const refetchRef = useRef<(() => void) | null>(null);
  const enrollmentLayoutHydratedRef = useRef(false);
  const enrollmentLayoutUpdatedAtRef = useRef<string | null>(null);
  const enrollmentLayoutSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const enrollmentLayoutSaveSequenceRef = useRef(0);
  const enrollmentLayoutProgramRef = useRef(program);
  const enrollmentLayoutBaselineRef = useRef<string | null>(null);

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
  const columnByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns]
  );
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
          !column.hidden_default
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
        setError(data?.error ?? "Không lưu được cấu hình bảng.");
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
  const mentionMembers = useMemo<TaskAssignee[]>(
    () =>
      people.map((person) => ({
        email: person.email,
        name: person.name,
      })),
    [people]
  );

  const visibleRecords = useMemo(
    () =>
      sortRecords(
        filterRecords(records, filters, optionsById, currentEmail),
        sort,
        optionsById,
        peopleByEmail
      ),
    [records, filters, optionsById, peopleByEmail, sort, currentEmail]
  );
  const exportColumnKeys = useMemo(
    () =>
      columns
        .filter(
          (column) =>
            column.locked || column.sticky || !hiddenColumnKeys.has(column.key)
        )
        .map((column) => column.key)
        .join(","),
    [columns, hiddenColumnKeys]
  );
  const exportRecordIds = useMemo(
    () => visibleRecords.map((record) => record.id),
    [visibleRecords]
  );
  const openRecord = records.find((record) => record.id === openId) ?? null;

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

  const refetch = useCallback(async () => {
    const seq = ++refetchSeqRef.current;
    // Captured BEFORE the request goes out: if a write is already in flight,
    // whatever the server returns cannot include it, so this snapshot is
    // stale-by-construction no matter what pendingRef looks like later.
    const hadPendingAtIssue = pendingRef.current.size > 0;
    try {
      const response = await fetch(`/api/enrollment?program=${program}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { records: EnrollmentRecordWithStats[] };
      // A newer refetch already superseded this one — dropping it is correct
      // and needs no re-run, the newer one carries at least as much.
      if (seq !== refetchSeqRef.current) return;
      if (hadPendingAtIssue || pendingRef.current.size > 0) {
        // Withheld, not discarded — this payload may carry other people's
        // changes. Re-run it. In the common case the write has ALREADY
        // settled by the time this response lands (the mutation is faster
        // than the refetch it raced), so the mutation's flush already ran and
        // will never run again — re-run right here instead of waiting for a
        // future mutation that may never come.
        if (pendingRef.current.size === 0) {
          refetchDirtyRef.current = false;
          refetchRef.current?.();
          return;
        }
        refetchDirtyRef.current = true;
        return;
      }
      refetchDirtyRef.current = false;
      updateRecords(() => data.records);
    } catch {
      // The next realtime ping or manual refresh will retry.
    }
  }, [program]);

  useEffect(() => {
    refetchRef.current = () => void refetch();
  }, [refetch]);

  // Re-run an update that was dropped because a write was in flight, so we
  // never trade "UI reverts" for "UI silently stale".
  const flushDeferredRefetch = useCallback(() => {
    if (pendingRef.current.size > 0) return;
    if (!refetchDirtyRef.current) return;
    refetchDirtyRef.current = false;
    void refetch();
  }, [refetch]);

  const reloadOptions = useCallback(async () => {
    const response = await fetch(
      `/api/enrollment/option-sets?program=${program}`,
      { cache: "no-store" }
    );
    if (!response.ok) return;
    const data = (await response.json()) as { options: EnrollmentOption[] };
    setOptions(data.options);
  }, [program]);

  // Auto-dismiss now lives in <Toast>; keeping a second timer here would be
  // duplicated logic that can drift out of sync with it.

  useEffect(() => {
    const initialRecordTimer = window.setTimeout(() => {
      setOpenId(new URL(window.location.href).searchParams.get("record"));
    }, 0);

    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ recordId?: unknown }>).detail;
      if (typeof detail?.recordId !== "string") return;
      setOpenId(detail.recordId);
      writeEnrollmentDeepLink(detail.recordId, "push");
    };
    window.addEventListener(OPEN_ENROLLMENT_EVENT, onOpen);
    return () => {
      window.clearTimeout(initialRecordTimer);
      window.removeEventListener(OPEN_ENROLLMENT_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    const onHistoryNavigation = () => {
      setOpenId(new URL(window.location.href).searchParams.get("record"));
    };
    window.addEventListener("popstate", onHistoryNavigation);
    return () => window.removeEventListener("popstate", onHistoryNavigation);
  }, []);

  useEffect(() => {
    const sb = getBrowserSupabase();
    if (!sb) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refetch();
        void reloadOptions();
      }, 300);
    };
    const channel = sb
      .channel(ENROLLMENT_TOPIC)
      .on("broadcast", { event: "changed" }, schedule)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refetch();
      });
    return () => {
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [refetch, reloadOptions]);

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
      const optimisticPatch = isPlainRecord(pending.patch.custom_values)
        ? {
            ...pending.patch,
            custom_values: {
              ...(isPlainRecord(next.custom_values) ? next.custom_values : {}),
              ...pending.patch.custom_values,
            },
          }
        : pending.patch;
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
    state.pending.push({ sequence, patch });

    const optimisticPatch = isPlainRecord(patch.custom_values)
      ? {
          ...patch,
          custom_values: {
            ...(isPlainRecord(before.custom_values) ? before.custom_values : {}),
            ...patch.custom_values,
          },
        }
      : patch;
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
            headers: { "Content-Type": "application/json" },
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

  async function createRecord(payload: Record<string, unknown>) {
    // Registered in pendingRef like any other write: without it a refetch
    // that raced this POST is treated as clean and applied, and the record
    // the user just created disappears from the list until the next ping.
    // The id isn't known yet, so use a placeholder key — pendingRef is only
    // ever checked for emptiness.
    const pendingKey = `create:${Date.now()}`;
    const finishPendingMutation = beginPending(pendingKey);
    try {
      const response = await fetch("/api/enrollment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, program }),
      });
      const data = (await response.json().catch(() => null)) as
        | { record?: EnrollmentRecordWithStats; error?: string }
        | null;
      if (!response.ok || !data?.record) {
        throw new Error(data?.error ?? "Could not create enrollment record.");
      }
      updateRecords((current) => [data.record!, ...current]);
      setOpenId(data.record.id);
      writeEnrollmentDeepLink(data.record.id, "push");
    } finally {
      finishPendingMutation();
    }
  }

  async function archiveRecord(id: string) {
    const before = recordRowsRef.current.get(id) ?? records.find((record) => record.id === id);
    if (!before) return;
    const beforeIndex = records.findIndex((record) => record.id === id);
    // Same reason as createRecord: an unguarded refetch would resurrect the
    // row we just removed.
    const finishPendingMutation = beginPending(id);
    updateRecords((current) => current.filter((record) => record.id !== id));
    setOpenId(null);
    writeEnrollmentDeepLink(null);
    try {
      const response = await fetch(`/api/enrollment/${id}`, { method: "DELETE" });
      if (!response.ok) {
        updateRecords((current) => {
          if (current.some((record) => record.id === id)) return current;
          const restored = [...current];
          restored.splice(Math.min(Math.max(beforeIndex, 0), restored.length), 0, before);
          return restored;
        });
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Could not archive record.");
      }
    } finally {
      finishPendingMutation();
    }
  }

  function openRecordById(id: string) {
    setOpenId(id);
    writeEnrollmentDeepLink(id, "push");
  }

  function closeRecord() {
    setOpenId(null);
    writeEnrollmentDeepLink(null);
  }

  const frameView = view === "list";
  const shellClassName = frameView
    ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7f9fc] text-[#172b4d]"
    : "flex min-h-full min-w-0 flex-col bg-[#f7f9fc] text-[#172b4d]";

  return (
    <div className={shellClassName}>
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
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0c66e4] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc]"
              >
                <Plus className="h-4 w-4" />
                New enrollment
              </button>
            </div>
          </header>

          <EnrollmentToolbar
            program={program}
            view={view}
            onViewChange={setView}
            filters={filters}
            setFilters={setFilters}
            people={people}
            agents={agents}
            optionsBySet={optionsBySet}
            columns={columns}
            hiddenColumnKeys={hiddenColumnKeys}
            onToggleColumn={toggleColumn}
            visibleCount={visibleRecords.length}
            totalCount={records.length}
          />
        </div>
      </div>

      {view === "overview" ? (
        <div className="min-w-0 px-6 pb-6">
          <div className="mx-auto max-w-[1760px]">
            <EnrollmentOverview
              key={program}
              program={program}
              onOpenRecord={openRecordById}
              canAssignRecord={(recordId) => {
                const record = records.find((candidate) => candidate.id === recordId);
                return Boolean(
                  record &&
                    canEditEnrollmentRecordClient(record, currentEmail, canManageOptions)
                );
              }}
              onAssign={(recordId, email) =>
                (async () => {
                  const record = records.find((candidate) => candidate.id === recordId);
                  if (
                    !record ||
                    !canEditEnrollmentRecordClient(record, currentEmail, canManageOptions)
                  ) {
                    setError("You cannot edit this enrollment record.");
                    return;
                  }
                  await patchRecord(recordId, { responsible_enroll_email: email });
                })()
              }
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
          isManager={canManageOptions}
          onClose={closeRecord}
          onPatch={(patch) => patchRecord(openRecord.id, patch)}
          onArchive={() => archiveRecord(openRecord.id)}
          onParentUpdatedAt={(updatedAt) =>
            updateRecords((current) =>
              current.map((record) =>
                record.id === openRecord.id
                  ? { ...record, updated_at: updatedAt }
                  : record
              )
            )
          }
          onParentRefresh={() => refetch()}
        />
      ) : null}

      {creating ? (
        <NewEnrollmentDialog
          program={program}
          peopleByEmail={peopleByEmail}
          agentsByEmail={agentsByEmail}
          optionsBySet={optionsBySet}
          visibleColumnKeys={adminVisibleColumnKeys}
          requiredColumnKeys={requiredColumnKeys}
          columnByKey={columnByKey}
          currentEmail={currentEmail}
          onClose={() => setCreating(false)}
          onCreate={async (payload) => {
            await createRecord(payload);
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
  onViewChange,
  filters,
  setFilters,
  people,
  agents,
  optionsBySet,
  columns,
  hiddenColumnKeys,
  onToggleColumn,
  visibleCount,
  totalCount,
}: {
  program: EnrollmentProgram;
  view: "list" | "overview";
  onViewChange: (view: "list" | "overview") => void;
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  people: EnrollmentPerson[];
  agents: TaskAgent[];
  optionsBySet: EnrollmentOptionsBySet;
  columns: EnrollmentColumn[];
  hiddenColumnKeys: Set<EnrollmentColumnKey>;
  onToggleColumn: (key: EnrollmentColumnKey) => void;
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
    filters.payment.length > 0 ||
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
            {(["overview", "list"] as const).map((key) => (
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

        {view === "list" ? (
          <div className="flex shrink-0 items-center gap-2">
            <DateRangeFilter
              from={filters.createdFrom}
              to={filters.createdTo}
              allDatesLabel="All created dates"
              onChange={({ from, to }) =>
                setFilters((current) => ({
                  ...current,
                  createdFrom: from,
                  createdTo: to,
                }))
              }
            />
          </div>
        ) : null}
      </div>

      {view === "list" ? (
      <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
        <TaskSelect
          label={columnByKey.get("stage")?.label ?? "Stage"}
          multi
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

        {!isMedicare ? (
          <TaskSelect
            label={columnByKey.get("payment")?.label ?? "Payment"}
            multi
            values={filters.payment}
            options={[
              { value: "", label: columnByKey.get("payment")?.label ?? "Payment" },
              ...selectOptions(optionsBySet.payment_status),
            ]}
            placeholder={columnByKey.get("payment")?.label ?? "Payment"}
            allValue=""
            summaryLabel="payments"
            className="w-max min-w-[10rem]"
            buttonClassName={FILTER_SELECT_BUTTON_CLASS}
            onValuesChange={(payment) =>
              setFilters((current) => ({ ...current, payment }))
            }
          />
        ) : null}

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
  const canEditRecord = canEditEnrollmentRecordClient(
    record,
    currentEmail,
    isManager
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
      onDoubleClick={() => onOpen(record.id)}
      className="group flex items-stretch whitespace-nowrap bg-white transition hover:bg-[#f7f8f9]"
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
            title={enrollmentKey(record.id)}
          >
            {enrollmentKey(record.id)}
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
          <EditableCustomCell
            column={{
              id: "client_name",
              type: "text",
              key: "client_name",
              label: columnByKey.get("client")?.label ?? "Client Name",
            }}
            value={record.client_name}
            canEdit={canEditRecord}
            onSave={(next) => onPatch(record.id, { client_name: next })}
            emptyLabel="Unnamed client"
            className="w-full !text-sm !font-medium !text-[#172b4d]"
          />
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
            canEdit={canEditRecord}
            onSave={(next) => onPatch(record.id, { due_date: next })}
            className="w-full !text-xs !font-medium !text-[#6b778c]"
          />
        </div>
      ) : null}

      {/* FUB Link */}
      {has("fub") ? (
        <div
          style={cellStyleFor("fub")}
          className={cellClassName("fub", "flex shrink-0 items-center justify-center px-2 py-2.5")}
        >
          {record.fub_link ? (
            <a
              href={formatExternalLink(record.fub_link)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#b3d4ff] bg-[#deebff] text-[#0055cc]"
              title="Open FUB"
              aria-label="Open FUB"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-xs text-[#97a0af]">-</span>
          )}
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
              canEdit={canEditRecord}
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
            canEdit={canEditRecord}
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
        field={field}
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
  field = false,
  canEdit = true,
  onChange,
}: {
  optionId: string | null;
  options: EnrollmentOption[];
  emptyLabel: string;
  field?: boolean;
  canEdit?: boolean;
  onChange: (value: string) => void;
}) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const option = optionId ? options.find((item) => item.id === optionId) ?? null : null;
  // Calmer than the Stage pill on purpose: these are attributes, not the
  // record's primary status, so they shouldn't compete visually with Stage.
  const style = optionPillStyle(option, 0.08);

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
        aria-expanded={isOpen}
        title={option?.label ?? emptyLabel}
        className={
          field
            ? DETAIL_FIELD_BUTTON_CLASS
            : "flex w-full min-w-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
        }
        style={
          field
            ? undefined
            : {
                backgroundColor: option ? style.bg : "transparent",
                color: option ? style.fg : "#97a0af",
              }
        }
      >
        <span
          className={`min-w-0 flex-1 truncate text-left ${
            field && !option ? "font-normal text-[#97a0af]" : ""
          }`}
        >
          {option?.label ?? emptyLabel}
        </span>
        <ChevronDown className={`${field ? "h-4 w-4" : "h-3 w-3"} shrink-0 opacity-60`} />
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="z-[100] max-h-64 overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              {options.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === optionId}
                  onClick={() => {
                    onChange(item.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-sm transition ${
                    item.id === optionId
                      ? "bg-[#e9f2ff] text-[#0c66e4]"
                      : "text-[#172b4d] hover:bg-[#f4f5f7]"
                  }`}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  {item.id === optionId ? (
                    <Check className="h-4 w-4 text-[#0c66e4]" />
                  ) : null}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function EnrollmentPersonMenu({
  value,
  peopleByEmail,
  emptyLabel,
  field = false,
  canEdit = true,
  onChange,
}: {
  value: string | null;
  peopleByEmail: Map<string, string>;
  emptyLabel: string;
  field?: boolean;
  canEdit?: boolean;
  onChange: (value: string | null) => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, setIsOpen } =
    useAnchoredMenu();
  const options = [...peopleByEmail.entries()]
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  const selectedLabel = value
    ? peopleByEmail.get(value) ?? formatEmailAsName(value)
    : emptyLabel;

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
        aria-expanded={isOpen}
        title={selectedLabel}
        className={field ? `${DETAIL_FIELD_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-60` : "flex w-full min-w-0 items-center disabled:cursor-not-allowed disabled:opacity-60"}
      >
        {value ? (
          <span
            className={`flex min-w-0 items-center gap-1.5 text-left font-semibold transition ${
              field ? "flex-1 text-sm text-[#172b4d]" : "text-xs text-[#42526e] hover:text-[#0c66e4]"
            }`}
          >
            <Initials email={value} label={selectedLabel} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate">{selectedLabel}</span>
            </span>
          </span>
        ) : (
          <span
            className={
              field
                ? "inline-flex min-w-0 items-center gap-1.5 text-sm font-normal text-[#97a0af]"
                : "inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff]"
            }
          >
            <UserPlus className={field ? "h-4 w-4" : "h-3 w-3"} />
            {field ? emptyLabel : "Assign"}
          </span>
        )}
        {field ? <ChevronDown className="ml-auto h-4 w-4 shrink-0 opacity-60" /> : null}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="z-[100] max-h-64 min-w-[14rem] overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => {
                  onChange(null);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-sm transition ${
                  !value
                    ? "bg-[#e9f2ff] text-[#0c66e4]"
                    : "text-[#172b4d] hover:bg-[#f4f5f7]"
                }`}
              >
                {emptyLabel}
                {!value ? <Check className="h-4 w-4 text-[#0c66e4]" /> : null}
              </button>
              {options.map(({ email, name }) => (
                <button
                  key={email}
                  type="button"
                  role="option"
                  aria-selected={email === value}
                  onClick={() => {
                    onChange(email);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-sm transition ${
                    email === value
                      ? "bg-[#e9f2ff] text-[#0c66e4]"
                      : "text-[#172b4d] hover:bg-[#f4f5f7]"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {email === value ? <Check className="h-4 w-4 text-[#0c66e4]" /> : null}
                </button>
              ))}
            </div>,
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
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const stage = stageId ? stages.find((option) => option.id === stageId) ?? null : null;
  const style = optionPillStyle(stage);
  const label = stage?.label ?? "No stage";
  const pill = field ? (
    <span className={DETAIL_FIELD_BUTTON_CLASS}>
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: style.fg }}
      />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
    </span>
  ) : (
    <span
      className="flex w-full min-w-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: style.bg, color: style.fg }}
    >
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <ChevronDown className="h-3 w-3 shrink-0" />
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
        aria-expanded={isOpen}
        title={label}
        className="block w-full min-w-0 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pill}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="z-[100] max-h-64 overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              {stages.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={option.id === stageId}
                  onClick={() => {
                    void onChange(option.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-sm transition ${
                    option.id === stageId
                      ? "bg-[#e9f2ff] text-[#0c66e4]"
                      : "text-[#172b4d] hover:bg-[#f4f5f7]"
                  }`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.id === stageId ? (
                    <Check className="h-4 w-4 text-[#0c66e4]" />
                  ) : null}
                </button>
              ))}
            </div>,
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
  isManager,
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
  isManager: boolean;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onArchive: () => Promise<void>;
  onParentUpdatedAt?: (updatedAt: string) => void;
  onParentRefresh?: () => Promise<void> | void;
}) {
  const [detail, setDetail] = useState<EnrollmentDetail | null>(null);
  const [tab, setTab] = useState<"comments" | "activity" | "files">("comments");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [reopenReasonOpen, setReopenReasonOpen] = useState(false);
  const [invalidKeys, setInvalidKeys] = useState<ReadonlySet<string>>(new Set());
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
  const canEditRecord = canEditEnrollmentRecordClient(
    record,
    currentEmail,
    isManager
  );
  const canArchive = canArchiveEnrollmentRecordClient(
    record,
    currentEmail,
    isManager
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

  const reload = useCallback(async () => {
    const response = await fetch(`/api/enrollment/${record.id}/detail`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    setDetail((await response.json()) as EnrollmentDetail);
  }, [record.id]);

  const reloadDetailAndParent = useCallback(async () => {
    await reload();
    await onParentRefresh?.();
  }, [onParentRefresh, reload]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDetail(null);
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  function reopen() {
    if (!reopenTarget || !canEditRecord) return;
    setReopenReasonOpen(true);
  }

  async function submitReopen(reason: string): Promise<boolean> {
    if (!reopenTarget || !canEditRecord) return false;
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
            {enrollmentKey(record.id)}
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
                    canEdit={canEditRecord}
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
                  <span className={LABEL_CLASS}>
                    {columnByKey.get("fub")?.label ?? "FUB Link"}
                    {requiredColumnKeys.has("fub") ? REQUIRED_MARK : null}
                  </span>
                  <div className="flex gap-1.5">
                    <EditableInput
                      value={record.fub_link ?? ""}
                      placeholder="No FUB link"
                      canEdit={canEditRecord}
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
                  canEdit={canEditRecord}
                  className={COMPACT_DESCRIPTION_CLASS}
                  onSave={(value) => onPatch({ description: value })}
                />
              </label>

              <section className="flex min-h-0 flex-1 flex-col gap-3 border-t border-[#dfe1e6] pt-4">
                <div className="flex shrink-0 flex-wrap items-center gap-5 border-b border-[#dfe1e6]">
                  <DrawerTab
                    label="Comments"
                    count={detail?.comments.length ?? record.comment_count}
                    active={tab === "comments"}
                    onClick={() => setTab("comments")}
                  />
                  <DrawerTab
                    label="Activity"
                    count={detail?.activity.length ?? 0}
                    active={tab === "activity"}
                    onClick={() => setTab("activity")}
                  />
                  <DrawerTab
                    label="Files"
                    count={detail?.attachments.length ?? record.attachment_count}
                    active={tab === "files"}
                    onClick={() => setTab("files")}
                  />
                </div>

                {!detail ? (
                  <DetailSkeleton />
                ) : tab === "comments" ? (
                  <CommentThread
                    taskId={record.id}
                    apiBase="/api/enrollment"
                    roomTopic={enrollmentRoomTopic(record.id)}
                    currentEmail={currentEmail}
                    members={mentionMembers}
                    comments={detail.comments}
                    onReload={reloadDetailAndParent}
                    onParentUpdatedAt={onParentUpdatedAt}
                  />
                ) : tab === "activity" ? (
                  <ActivityFeed
                    activity={detail.activity}
                    personLabelByEmail={peopleByEmail}
                  />
                ) : (
                  <AttachmentPanel
                    attachments={detail.attachments}
                    taskId={record.id}
                    apiBase="/api/enrollment"
                    canEdit={canEditRecord}
                    onReload={reloadDetailAndParent}
                  />
                )}
              </section>
            </main>

          <aside className="space-y-4 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0 lg:overflow-y-auto">
            <div className="space-y-3">
              {showStage ? (
                <FieldBlock
                  label={columnByKey.get("stage")?.label ?? "Stage"}
                  required={requiredColumnKeys.has("stage")}
                >
                  <EnrollmentStagePill
                    stageId={record.stage_id}
                    stages={optionsBySet.stage}
                    field
                    canEdit={canEditRecord}
                    onChange={(value) => onPatch({ stage_id: value })}
                  />
                </FieldBlock>
              ) : null}

              {showDue ? (
                <FieldBlock
                  label={columnByKey.get("due")?.label ?? "Due date"}
                  required={requiredColumnKeys.has("due")}
                >
                  <input
                    type="date"
                    value={formatDateInput(record.due_date)}
                    disabled={!canEditRecord}
                    onChange={(event) => {
                      const nextDueDate = event.target.value || null;
                      if (nextDueDate === formatDateInput(record.due_date)) return;
                      void onPatch({ due_date: nextDueDate });
                    }}
                    className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold disabled:cursor-not-allowed disabled:bg-[#f4f5f7]`}
                  />
                </FieldBlock>
              ) : null}

              {showPayment ? (
                <FieldBlock
                  label={columnByKey.get("payment")?.label ?? "Payment"}
                  required={requiredColumnKeys.has("payment")}
                >
                  <EnrollmentOptionMenu
                    optionId={record.payment_status_id}
                    options={optionsBySet.payment_status}
                    emptyLabel="No payment"
                    field
                    canEdit={canEditRecord}
                    onChange={(value) => void onPatch({ payment_status_id: value })}
                  />
                </FieldBlock>
              ) : null}

              {showCarrier ? (
                <FieldBlock
                  label={columnByKey.get("carrier")?.label ?? "Carrier"}
                  required={requiredColumnKeys.has("carrier")}
                >
                  <EnrollmentOptionMenu
                    optionId={record.carrier_id}
                    options={optionsBySet.carrier}
                    emptyLabel="No carrier"
                    field
                    canEdit={canEditRecord}
                    onChange={(value) => void onPatch({ carrier_id: value })}
                  />
                </FieldBlock>
              ) : null}

              {showAca ? (
                  <FieldBlock
                    label={columnByKey.get("aca")?.label ?? "AC"}
                    required={requiredColumnKeys.has("aca")}
                  >
                    <EnrollmentOptionMenu
                      optionId={record.aca_status_id}
                      options={optionsBySet.aca_status}
                      emptyLabel="No AC status"
                      field
                      canEdit={canEditRecord}
                      onChange={(value) => void onPatch({ aca_status_id: value })}
                    />
                  </FieldBlock>
              ) : null}

              {showConsent ? (
                  <FieldBlock
                    label={columnByKey.get("consent")?.label ?? "Consent"}
                    required={requiredColumnKeys.has("consent")}
                  >
                    <EnrollmentConsentToggle
                      optionId={record.consent_id}
                      options={optionsBySet.consent}
                      field
                      canEdit={canEditRecord}
                      onChange={(value) => void onPatch({ consent_id: value })}
                    />
                  </FieldBlock>
              ) : null}

              {showPlatform ? (
                  <FieldBlock
                    label={columnByKey.get("platform")?.label ?? "Platform"}
                    required={requiredColumnKeys.has("platform")}
                  >
                    <EnrollmentOptionMenu
                      optionId={record.platform_id}
                      options={optionsBySet.platform}
                      emptyLabel="No platform"
                      field
                      canEdit={canEditRecord}
                      onChange={(value) => void onPatch({ platform_id: value })}
                    />
                  </FieldBlock>
              ) : null}

              {showAgent ? (
                <FieldBlock
                  label={columnByKey.get("agent")?.label ?? "Agent"}
                  required={requiredColumnKeys.has("agent")}
                  invalid={isInvalid("agent")}
                >
                  <EnrollmentPersonMenu
                    value={record.agent_email}
                    peopleByEmail={agentsByEmail}
                    emptyLabel="No agent"
                    field
                    canEdit={canEditRecord}
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
                  label={columnByKey.get("caller")?.label ?? "Caller"}
                  required={requiredColumnKeys.has("caller")}
                >
                  <EnrollmentPersonMenu
                    value={record.caller_email}
                    peopleByEmail={peopleByEmail}
                    emptyLabel="No caller"
                    field
                    canEdit={canEditRecord}
                    onChange={(value) => void onPatch({ caller_email: value })}
                  />
                </FieldBlock>
              ) : null}

              {showResponsible ? (
                <FieldBlock
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
                    field
                    canEdit={canEditRecord}
                    onChange={(value) =>
                      void onPatch({ responsible_enroll_email: value })
                    }
                  />
                </FieldBlock>
              ) : null}

              {showCreatedBy ? (
                <FieldBlock label={columnByKey.get("createdBy")?.label ?? "Created by"}>
                  <div className="min-h-9 rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-2 text-sm font-medium text-[#172b4d]">
                    {personLabel(record.created_by_email, peopleByEmail)}
                  </div>
                </FieldBlock>
              ) : null}

              {showPcp2025 ? (
                <FieldBlock
                  label={
                    columnByKey.get("pcp2025")?.label ?? (isMedicare ? "PCP" : "PCP 2025")
                  }
                  required={requiredColumnKeys.has("pcp2025")}
                >
                  <EditableInput
                    value={record.pcp_2025 ?? ""}
                    placeholder={isMedicare ? "No PCP" : "No PCP 2025"}
                    canEdit={canEditRecord}
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
                  label={columnByKey.get("pcp2026")?.label ?? "PCP 2026"}
                  required={requiredColumnKeys.has("pcp2026")}
                >
                  <EditableInput
                    value={record.pcp_2026 ?? ""}
                    placeholder="No PCP 2026"
                    canEdit={canEditRecord}
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
                <FieldBlock key={column.id} label={column.label} required={column.required}>
                  <EnrollmentDetailCustomFieldControl
                    column={column}
                    value={record.custom_values?.[column.key]}
                    options={optionsByColumnId.get(column.id) ?? []}
                    people={customPeople}
                    optionLabelById={optionLabelById}
                    personLabelByEmail={peopleByEmail}
                    canEdit={canEditRecord}
                    onSave={(next) =>
                      onPatch({ custom_values: { [column.key]: next } })
                    }
                  />
                </FieldBlock>
              ))}

              {showQc ? (
                <FieldBlock label={columnByKey.get("qc")?.label ?? "QC Review"}>
                  <EnrollmentQCPanel
                    record={record}
                    stage={stage}
                    canEdit={canEditRecord}
                    onToggle={() => onPatch({ qc_checked: !record.qc_checked_at })}
                  />
                </FieldBlock>
              ) : null}
            </div>

            {canEditRecord && stage?.is_terminal && reopenTarget ? (
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

            {canArchive && (
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
  currentEmail: string;
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
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
    return invalidKeys.has(key) && !isFilled(formField ? form[formField] : undefined);
  }

  function update(field: string, value: string | null) {
    setForm((current) => ({ ...current, [field]: value ?? "" }));
  }

  async function submit() {
    const missing = [...requiredColumnKeys].filter((key) => {
      const formField = ENROLLMENT_FORM_FIELD_BY_KEY[key];
      return formField && !isFilled(form[formField]);
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
          }
        : form;
      await onCreate(payload);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create record.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#091e42]/40 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#d8dee8] px-5 py-3">
          <div>
            <h2 className="text-lg font-bold text-[#172b4d]">New enrollment</h2>
            <p className="text-sm font-medium text-[#6b778c]">
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
            aria-label="Close"
            className="rounded p-1.5 text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_320px]">
            <main className="min-w-0 space-y-3 px-6 py-5">
              <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className={LABEL_CLASS}>
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
                <span className={LABEL_CLASS}>
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

              {error ? (
                <div className="rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-bold text-[#bf2600]">
                  {error}
                </div>
              ) : null}
            </main>

            <aside className="min-w-0 space-y-4 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#172b4d]">Properties</h3>
                  <p className="text-xs font-medium text-[#6b778c]">
                    Enrollment fields stay on the right for fast scanning.
                  </p>
                </div>
                <span className="shrink-0 rounded bg-[#e9f2ff] px-2 py-1 text-[11px] font-bold text-[#0c66e4]">
                  {ENROLLMENT_PROGRAM_LABELS[program].replace("Health ", "")}
                </span>
              </div>

              {showPipelineSection ? (
                <CreatePropertySection>
                  {showStage ? (
                    <CreatePropertyField
                      label={columnByKey.get("stage")?.label ?? "Stage"}
                      required={requiredColumnKeys.has("stage")}
                      invalid={isInvalid("stage")}
                    >
                      <EnrollmentStagePill
                        stageId={form.stage_id || null}
                        stages={optionsBySet.stage}
                        onChange={async (value) => update("stage_id", value)}
                      />
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
                <CreatePropertySection>
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
                        onChange={(value) => update("platform_id", value)}
                      />
                    </CreatePropertyField>
                  ) : null}
                </CreatePropertySection>
              ) : null}

              {showOwnershipSection ? (
                <CreatePropertySection>
                  {showAgent ? (
                    <CreatePropertyField
                      label={columnByKey.get("agent")?.label ?? "Agent"}
                      required={requiredColumnKeys.has("agent")}
                      invalid={isInvalid("agent")}
                    >
                      <EnrollmentPersonMenu
                        value={form.agent_email || null}
                        peopleByEmail={agentsByEmail}
                        emptyLabel="No agent"
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
                        emptyLabel="No caller"
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
                        onChange={(value) => update("responsible_enroll_email", value)}
                      />
                    </CreatePropertyField>
                  ) : null}
                </CreatePropertySection>
              ) : null}

              {showPcpSection ? (
                <CreatePropertySection>
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
            </aside>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-[#d8dee8] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded px-3 text-sm font-bold text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="h-9 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </footer>
      </div>
    </div>
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

  useEffect(() => {
    autosizeTextarea(textareaRef.current);
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      disabled={!canEdit}
      onClick={(event) => event.stopPropagation()}
      onInput={(event) => autosizeTextarea(event.currentTarget)}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next !== value.trim()) void onSave(next || null);
      }}
      rows={2}
      className={`${className} disabled:cursor-not-allowed disabled:bg-[#f4f5f7]`}
    />
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
      className={DETAIL_FIELD_DISPLAY_CLASS}
      inputClassName={DETAIL_FIELD_INPUT_CLASS}
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
      <div className={invalid ? `${INVALID_RING_CLASS} rounded-lg` : undefined}>
        {children}
      </div>
    </div>
  );
}

function CreatePropertySection({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-[#dfe1e6] pt-4 first:border-t-0 first:pt-0">
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
    <CreatePropertyField label={label} required={required} invalid={invalid}>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-full min-w-0 bg-transparent px-0 text-sm font-semibold text-[#172b4d] outline-none placeholder:text-[#97a0af]"
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
    if (
      filters.payment.length > 0 &&
      !filters.payment.includes(record.payment_status_id ?? "")
    ) {
      return false;
    }
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
      return enrollmentKey(record.id);
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

function optionPillStyle(
  option: EnrollmentOption | null,
  alpha = 0.14
): {
  bg: string;
  fg: string;
} {
  if (!option?.color) return { bg: "#f4f5f7", fg: "#5e6c84" };
  return {
    bg: hexToRgba(option.color, alpha) ?? "#dfe1e6",
    fg: option.color,
  };
}

function hexToRgba(hex: string, alpha: number): string | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  const [, r, g, b] = match;
  return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
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

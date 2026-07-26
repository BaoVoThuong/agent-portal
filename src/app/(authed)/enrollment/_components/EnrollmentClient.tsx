"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  Plus,
  RefreshCw,
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
  enrollmentIsDueSoon,
  enrollmentIsOverdue,
  enrollmentKey,
  formatDateInput,
  formatDateShort,
  optionLabel,
} from "@/lib/enrollment/helpers";
import {
  compareEnrollmentOptionText,
  emptyEnrollmentOptionsBySet,
  ENROLLMENT_OPTION_LABELS,
  optionById,
  sortEnrollmentOptionsByLabel,
  type EnrollmentOptionsBySet,
} from "@/lib/enrollment/options";
import {
  ENROLLMENT_PROGRAMS,
  ENROLLMENT_PROGRAM_LABELS,
  type EnrollmentDetail,
  type EnrollmentOption,
  type EnrollmentOptionSet,
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
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { formatEmailAsName, personLabel } from "@/lib/tasks/people";
import { CommentThread } from "../../tasks/_components/CommentThread";
import { ActivityFeed } from "../../tasks/_components/ActivityFeed";
import { AttachmentPanel } from "../../tasks/_components/AttachmentPanel";
import { TaskSelect } from "../../tasks/_components/TaskSelect";
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
  caller: string[];
  responsible: string[];
  carrier: string[];
  payment: string[];
  attention: boolean;
  overdue: boolean;
  qcNeeded: boolean;
  unowned: boolean;
  dueFrom: string;
  dueTo: string;
};

const DEFAULT_FILTERS: Filters = {
  query: "",
  stage: [],
  caller: [],
  responsible: [],
  carrier: [],
  payment: [],
  attention: false,
  overdue: false,
  qcNeeded: false,
  unowned: false,
  dueFrom: "",
  dueTo: "",
};

const DATE_INPUT_CLASS =
  "h-9 rounded border border-[#d8dee8] bg-white px-2 text-sm font-semibold text-[#172b4d] outline-none focus:border-[#0c66e4] focus:ring-2 focus:ring-[#deebff]";

const FILTER_SELECT_BUTTON_CLASS =
  "!h-9 !rounded-lg !border !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";
const INPUT_CLASS =
  "w-full rounded border-2 border-[#dfe1e6] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:border-[#dfe1e6] disabled:bg-[#f4f5f7] disabled:text-[#6b778c]";
const LABEL_CLASS =
  "text-xs font-bold uppercase tracking-wide text-[#6b778c]";

// Column layout for the enrollment list — mirrors the Slack List this module
// replaces: every field is its own fixed-width column so the table scrolls
// horizontally instead of hiding data. "sticky" columns (Key, Client) stay
// pinned on the left while the rest scrolls underneath, same as Slack.
type EnrollmentColumn = {
  key: SortKey | "fub";
  label: string;
  width: number;
  sticky?: boolean;
  sortable?: boolean;
  align?: "center";
};
type EnrollmentColumnKey = EnrollmentColumn["key"];

// Base (ACA) column set — every field ACA uses. Medicare has no
// Payment/Consent/Platform/AC concepts and only one owner/PCP field (see the
// real Medicare Slack List), so enrollmentColumnsForProgram() below derives a
// trimmed, relabeled set from this instead of duplicating the whole table.
const ACA_ENROLLMENT_COLUMNS: EnrollmentColumn[] = [
  { key: "key", label: "Key", width: 100, sticky: true, sortable: true },
  { key: "client", label: "Client Name", width: 300, sticky: true, sortable: true },
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
  { key: "qc", label: "QC", width: 64, sticky: true, align: "center", sortable: true },
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

function enrollmentColumnsForProgram(program: EnrollmentProgram): EnrollmentColumn[] {
  if (program !== "medicare") return ACA_ENROLLMENT_COLUMNS;
  return ACA_ENROLLMENT_COLUMNS.filter((column) => !MEDICARE_HIDDEN_COLUMNS.has(column.key)).map(
    (column) =>
      MEDICARE_COLUMN_LABELS[column.key]
        ? { ...column, label: MEDICARE_COLUMN_LABELS[column.key]! }
        : column
  );
}

const ENROLLMENT_COLUMN_KEYS = new Set(ACA_ENROLLMENT_COLUMNS.map((column) => column.key));

function browserStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function useHiddenEnrollmentColumns(program: EnrollmentProgram) {
  const [hiddenByProgram, setHiddenByProgram] = useState<
    Record<EnrollmentProgram, Set<EnrollmentColumnKey>>
  >(() =>
    Object.fromEntries(
      ENROLLMENT_PROGRAMS.map((value) => [value, new Set<EnrollmentColumnKey>()])
    ) as Record<EnrollmentProgram, Set<EnrollmentColumnKey>>
  );
  const hiddenKeys = hiddenByProgram[program];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHiddenByProgram(
        Object.fromEntries(
          ENROLLMENT_PROGRAMS.map((value) => [
            value,
            readHiddenColumns(
              browserStorage(),
              value,
              ENROLLMENT_COLUMN_KEYS
            ) as Set<EnrollmentColumnKey>,
          ])
        ) as Record<EnrollmentProgram, Set<EnrollmentColumnKey>>
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toggleColumn = useCallback(
    (key: EnrollmentColumnKey) => {
      const column = ACA_ENROLLMENT_COLUMNS.find((item) => item.key === key);
      setHiddenByProgram((current) => {
        const next = toggleHiddenColumn(
          current[program],
          key,
          Boolean(column?.sticky)
        ) as Set<EnrollmentColumnKey>;
        writeHiddenColumns(browserStorage(), program, next);
        return { ...current, [program]: next };
      });
    },
    [program]
  );

  return [hiddenKeys, toggleColumn] as const;
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

export function EnrollmentClient({
  program,
  initialRecords,
  people,
  optionSets,
  initialOptions,
  currentEmail,
  canManageOptions,
}: {
  program: EnrollmentProgram;
  initialRecords: EnrollmentRecordWithStats[];
  people: EnrollmentPerson[];
  optionSets: EnrollmentOptionSet[];
  initialOptions: EnrollmentOption[];
  currentEmail: string;
  canManageOptions: boolean;
}) {
  const [records, setRecords] = useState(initialRecords);
  const [options, setOptions] = useState(initialOptions);
  const [view, setView] = useState<"list" | "overview">("list");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "attention",
    dir: "desc",
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managingOptions, setManagingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(new Set<string>());

  const optionsById = useMemo(() => optionById(options), [options]);
  const optionsBySet = useMemo(() => groupOptions(options), [options]);
  const columns = useMemo(() => enrollmentColumnsForProgram(program), [program]);
  const [hiddenColumnKeys, toggleColumn] = useHiddenEnrollmentColumns(program);
  const visibleColumns = useMemo(
    () =>
      columns.filter((column) => column.sticky || !hiddenColumnKeys.has(column.key)),
    [columns, hiddenColumnKeys]
  );
  // How many live records reference each option — shown in the archive
  // confirm dialog so an admin can see the blast radius before archiving
  // (this is what silently broke the ACA Payment "Auto pay" option earlier).
  const optionUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (id: string | null) => {
      if (!id) return;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    };
    for (const record of records) {
      bump(record.stage_id);
      bump(record.carrier_id);
      bump(record.platform_id);
      bump(record.consent_id);
      bump(record.payment_status_id);
      bump(record.aca_status_id);
    }
    return counts;
  }, [records]);
  const peopleByEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of people) {
      map.set(person.email, person.name?.trim() || formatEmailAsName(person.email));
    }
    if (!map.has(currentEmail)) map.set(currentEmail, formatEmailAsName(currentEmail));
    return map;
  }, [currentEmail, people]);
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
        filterRecords(records, filters, optionsById),
        sort,
        optionsById,
        peopleByEmail
      ),
    [records, filters, optionsById, peopleByEmail, sort]
  );
  const openRecord = records.find((record) => record.id === openId) ?? null;

  const refetch = useCallback(async () => {
    try {
      const response = await fetch(`/api/enrollment?program=${program}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { records: EnrollmentRecordWithStats[] };
      if (pendingRef.current.size === 0) setRecords(data.records);
    } catch {
      // The next realtime ping or manual refresh will retry.
    }
  }, [program]);

  const reloadOptions = useCallback(async () => {
    const response = await fetch(
      `/api/enrollment/option-sets?program=${program}`,
      { cache: "no-store" }
    );
    if (!response.ok) return;
    const data = (await response.json()) as { options: EnrollmentOption[] };
    setOptions(data.options);
  }, [program]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

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
      timer = setTimeout(() => void refetch(), 300);
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
  }, [refetch]);

  async function patchRecord(id: string, patch: Record<string, unknown>) {
    const before = records.find((record) => record.id === id);
    if (!before) return;
    pendingRef.current.add(id);
    setRecords((current) =>
      current.map((record) => (record.id === id ? ({ ...record, ...patch } as EnrollmentRecordWithStats) : record))
    );

    try {
      const response = await fetch(`/api/enrollment/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, expected_updated_at: before.updated_at }),
      });
      const data = (await response.json().catch(() => null)) as
        | { record?: EnrollmentRecordWithStats; error?: string }
        | null;
      if (!response.ok || !data?.record) {
        throw new Error(data?.error ?? "Could not update enrollment record.");
      }
      setRecords((current) =>
        current.map((record) => (record.id === id ? data.record! : record))
      );
    } catch (updateError) {
      setRecords((current) =>
        current.map((record) => (record.id === id ? before : record))
      );
      setError(updateError instanceof Error ? updateError.message : "Could not update record.");
    } finally {
      pendingRef.current.delete(id);
    }
  }

  async function createRecord(payload: Record<string, unknown>) {
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
    setRecords((current) => [data.record!, ...current]);
    setOpenId(data.record.id);
    writeEnrollmentDeepLink(data.record.id, "push");
  }

  async function archiveRecord(id: string) {
    const before = records;
    setRecords((current) => current.filter((record) => record.id !== id));
    setOpenId(null);
    writeEnrollmentDeepLink(null);
    const response = await fetch(`/api/enrollment/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setRecords(before);
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not archive record.");
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

  return (
    <div className="min-h-full bg-[#f7f9fc] px-6 py-7 text-[#172b4d]">
      <div className="mx-auto flex max-w-[1760px] flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0c66e4]">
              Health Enrollment
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-normal text-[#172b4d]">
              {ENROLLMENT_PROGRAM_LABELS[program]}
            </h1>
            <nav className="mt-3 inline-flex rounded-lg bg-[#f4f5f7] p-0.5">
              {ENROLLMENT_PROGRAMS.map((value) => (
                <a
                  key={value}
                  href={`/enrollment?program=${value}`}
                  aria-current={value === program ? "page" : undefined}
                  className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
                    value === program
                      ? "bg-white text-[#0c66e4] shadow-sm"
                      : "text-[#5e6c84] hover:text-[#172b4d]"
                  }`}
                >
                  {ENROLLMENT_PROGRAM_LABELS[value]}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {canManageOptions ? (
              <button
                type="button"
                onClick={() => setManagingOptions(true)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
              >
                <Settings2 className="h-4 w-4" />
                Option sets
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc]"
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
          optionsBySet={optionsBySet}
          columns={columns}
          hiddenColumnKeys={hiddenColumnKeys}
          onToggleColumn={toggleColumn}
          visibleCount={visibleRecords.length}
          totalCount={records.length}
        />

        {view === "overview" ? (
          <EnrollmentOverview
            key={program}
            program={program}
            onOpenRecord={openRecordById}
            onAssign={(recordId, email) =>
              patchRecord(recordId, { responsible_enroll_email: email })
            }
          />
        ) : (
          <EnrollmentTable
            columns={visibleColumns}
            records={visibleRecords}
            peopleByEmail={peopleByEmail}
            optionsById={optionsById}
            optionsBySet={optionsBySet}
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
        )}
      </div>

      {error ? (
        <div className="fixed bottom-4 right-4 z-[200] rounded-lg border border-[#ffbdad] bg-white px-4 py-3 text-sm font-bold text-[#bf2600] shadow-xl">
          {error}
        </div>
      ) : null}

      {openRecord ? (
        <EnrollmentDrawer
          record={openRecord}
          peopleByEmail={peopleByEmail}
          mentionMembers={mentionMembers}
          optionsById={optionsById}
          optionsBySet={optionsBySet}
          currentEmail={currentEmail}
          onClose={closeRecord}
          onPatch={(patch) => patchRecord(openRecord.id, patch)}
          onArchive={() => archiveRecord(openRecord.id)}
        />
      ) : null}

      {creating ? (
        <NewEnrollmentDialog
          program={program}
          people={people}
          optionsBySet={optionsBySet}
          currentEmail={currentEmail}
          onClose={() => setCreating(false)}
          onCreate={async (payload) => {
            await createRecord(payload);
            setCreating(false);
          }}
        />
      ) : null}

      {managingOptions ? (
        <OptionSetManager
          program={program}
          optionSets={optionSets}
          optionsBySet={optionsBySet}
          optionUsageCounts={optionUsageCounts}
          onClose={() => setManagingOptions(false)}
          onChanged={reloadOptions}
        />
      ) : null}
    </div>
  );
}

function EnrollmentToolbar({
  program,
  view,
  onViewChange,
  filters,
  setFilters,
  people,
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
  optionsBySet: EnrollmentOptionsBySet;
  columns: EnrollmentColumn[];
  hiddenColumnKeys: Set<EnrollmentColumnKey>;
  onToggleColumn: (key: EnrollmentColumnKey) => void;
  visibleCount: number;
  totalCount: number;
}) {
  const isMedicare = program === "medicare";
  const hasActiveFilters =
    filters.query.trim() !== "" ||
    filters.stage.length > 0 ||
    filters.caller.length > 0 ||
    filters.responsible.length > 0 ||
    filters.carrier.length > 0 ||
    filters.payment.length > 0 ||
    filters.attention ||
    filters.overdue ||
    filters.qcNeeded ||
    filters.unowned ||
    filters.dueFrom !== "" ||
    filters.dueTo !== "";

  return (
    <section className="mt-6 space-y-3">
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
                placeholder="Search task name and comments..."
                className="h-10 w-full rounded border-2 border-transparent bg-[#f4f5f7] pl-10 pr-9 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#44546f] hover:bg-[#ebecf0] focus:border-[#0c66e4] focus:bg-white"
              />
            </div>
          ) : null}
        </div>

        {view === "list" ? (
          <div className="flex shrink-0 items-center gap-2">
            <EnrollmentDueRangeFilter
              from={filters.dueFrom}
              to={filters.dueTo}
              onChange={({ from, to }) =>
                setFilters((current) => ({ ...current, dueFrom: from, dueTo: to }))
              }
            />
          </div>
        ) : null}
      </div>

      {view === "list" ? (
      <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
        <TaskSelect
          label="Stage"
          multi
          values={filters.stage}
          options={[{ value: "", label: "Stage" }, ...selectOptions(optionsBySet.stage)]}
          placeholder="Stage"
          allValue=""
          summaryLabel="stages"
          className="w-max min-w-[8.75rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onValuesChange={(stage) => setFilters((current) => ({ ...current, stage }))}
        />

        {!isMedicare ? (
          <TaskSelect
            label="Caller"
            multi
            values={filters.caller}
            options={[{ value: "", label: "All Callers" }, ...peopleOptions(people)]}
            placeholder="Caller"
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
          label={isMedicare ? "Assignee" : "Responsible"}
          multi
          values={filters.responsible}
          options={[
            { value: "", label: isMedicare ? "All Assignees" : "All Responsible" },
            ...peopleOptions(people),
          ]}
          placeholder={isMedicare ? "Assignee" : "Responsible"}
          allValue=""
          summaryLabel="people"
          className="w-max min-w-[11rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onValuesChange={(responsible) =>
            setFilters((current) => ({ ...current, responsible }))
          }
        />

        <TaskSelect
          label="Carrier"
          multi
          values={filters.carrier}
          options={[{ value: "", label: "Carrier" }, ...selectOptions(optionsBySet.carrier)]}
          placeholder="Carrier"
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
            label="Payment"
            multi
            values={filters.payment}
            options={[{ value: "", label: "Payment" }, ...selectOptions(optionsBySet.payment_status)]}
            placeholder="Payment"
            allValue=""
            summaryLabel="payments"
            className="w-max min-w-[10rem]"
            buttonClassName={FILTER_SELECT_BUTTON_CLASS}
            onValuesChange={(payment) =>
              setFilters((current) => ({ ...current, payment }))
            }
          />
        ) : null}

        <ToolbarToggleButton
          active={filters.overdue}
          onClick={() =>
            setFilters((current) => ({ ...current, overdue: !current.overdue }))
          }
        >
          Overdue
        </ToolbarToggleButton>

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

function ToolbarToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-sm font-semibold transition ${
        active
          ? "border-[#0c66e4] bg-[#deebff] text-[#0c66e4]"
          : "border-[#dfe1e6] bg-white text-[#42526e] hover:border-[#c1c7d0]"
      }`}
    >
      {children}
    </button>
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
  const toggleableColumns = columns.filter((column) => !column.sticky);
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

function EnrollmentDueRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (value: { from: string; to: string }) => void;
}) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const [draft, setDraft] = useState({ from, to });
  const label = formatEnrollmentDateRangeLabel(from, to);

  function applyRange() {
    onChange(finalizeEnrollmentDateRange(draft.from, draft.to));
    setIsOpen(false);
  }

  function clearRange() {
    setDraft({ from: "", to: "" });
    onChange({ from: "", to: "" });
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!isOpen) setDraft({ from, to });
          toggle();
        }}
        className={`dashboard-filter-button min-w-[13.75rem] ${FILTER_SELECT_BUTTON_CLASS}`}
        aria-expanded={isOpen}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-[#44546f]" />
          <span className="truncate font-medium">{label}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#667085]" />
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="dashboard-filter-menu z-[110] w-[min(18rem,calc(100vw-1rem))] p-3"
            >
              <div className="grid gap-3">
                <label className="grid gap-1.5">
                  <span className="text-[0.68rem] font-bold uppercase tracking-wide text-[#6b778c]">
                    Due from
                  </span>
                  <input
                    type="date"
                    value={draft.from}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        from: event.target.value,
                      }))
                    }
                    className={`${DATE_INPUT_CLASS} w-full`}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[0.68rem] font-bold uppercase tracking-wide text-[#6b778c]">
                    Due to
                  </span>
                  <input
                    type="date"
                    value={draft.to}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, to: event.target.value }))
                    }
                    className={`${DATE_INPUT_CLASS} w-full`}
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={clearRange}
                  className="mr-auto rounded px-2 py-1.5 text-xs font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff]"
                >
                  Clear dates
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded px-2 py-1.5 text-xs font-bold text-[#42526e] transition hover:bg-[#f4f5f7]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyRange}
                  className="rounded bg-[#0c66e4] px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#0055cc]"
                >
                  Apply
                </button>
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
  optionsById,
  optionsBySet,
  sort,
  onSort,
  onOpen,
  onPatch,
}: {
  columns: EnrollmentColumn[];
  records: EnrollmentRecordWithStats[];
  peopleByEmail: Map<string, string>;
  optionsById: Map<string, EnrollmentOption>;
  optionsBySet: EnrollmentOptionsBySet;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const minWidth = useMemo(
    () => columns.reduce((sum, column) => sum + column.width, 0),
    [columns]
  );

  return (
    <div className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
      {records.length === 0 ? (
        <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
          No enrollment records match this view.
        </div>
      ) : (
        <div className="overflow-x-auto">
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
            <ul className="divide-y divide-[#ebecf0]">
              {records.map((record) => (
                <li key={record.id}>
                  <EnrollmentRowItem
                    columns={columns}
                    record={record}
                    peopleByEmail={peopleByEmail}
                    optionsById={optionsById}
                    optionsBySet={optionsBySet}
                    onOpen={onOpen}
                    onPatch={onPatch}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function EnrollmentRowItem({
  columns,
  record,
  peopleByEmail,
  optionsById,
  optionsBySet,
  onOpen,
  onPatch,
}: {
  columns: EnrollmentColumn[];
  record: EnrollmentRecordWithStats;
  peopleByEmail: Map<string, string>;
  optionsById: Map<string, EnrollmentOption>;
  optionsBySet: EnrollmentOptionsBySet;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
  const overdue = enrollmentIsOverdue(record);
  const risk = enrollmentRisk(record, stage);
  const has = (key: EnrollmentColumn["key"]) => columns.some((column) => column.key === key);

  function cellStyle(column: EnrollmentColumn): React.CSSProperties {
    return {
      width: column.width,
      left: column.sticky ? stickyOffset(columns, column.key) : undefined,
    };
  }

  return (
    <div
      onDoubleClick={() => onOpen(record.id)}
      className="group flex items-stretch whitespace-nowrap bg-white transition hover:bg-[#f7f8f9]"
    >
      {/* Key — carries the overdue accent so it stays visible while the row is
          scrolled horizontally (this is the leftmost sticky column). */}
      <div
        style={cellStyle(columns[0])}
        className={`sticky z-[1] flex shrink-0 items-center border-r border-[#dfe1e6] bg-white px-3 py-2.5 group-hover:bg-[#f7f8f9] ${
          overdue ? "border-l-4 border-l-[#f97316]" : ""
        }`}
      >
        <span
          className="truncate font-mono text-xs font-bold text-[#97a0af]"
          title={enrollmentKey(record.id)}
        >
          {enrollmentKey(record.id)}
        </span>
      </div>

      {/* Client Name */}
      <div
        style={cellStyle(columns[1])}
        className="sticky z-[1] flex shrink-0 items-center border-r border-[#dfe1e6] bg-white px-3 py-2.5 group-hover:bg-[#f7f8f9]"
      >
        <button
          type="button"
          onClick={() => onOpen(record.id)}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[#172b4d] hover:text-[#0c66e4]"
          title={record.client_name ?? undefined}
        >
          {record.client_name || "Unnamed client"}
        </button>
      </div>

      {/* Stage */}
      {has("stage") ? (
        <div style={{ width: colWidth(columns, "stage") }} className="flex shrink-0 items-center px-3 py-2.5">
          <EnrollmentStagePill
            stageId={record.stage_id}
            stages={optionsBySet.stage}
            onChange={(value) => onPatch(record.id, { stage_id: value })}
          />
        </div>
      ) : null}

      {/* Caller — ACA only; Medicare has a single Assignee (Responsible). */}
      {has("caller") ? (
        <div style={{ width: colWidth(columns, "caller") }} className="flex shrink-0 items-center px-3 py-2.5">
          <EnrollmentPersonMenu
            value={record.caller_email}
            peopleByEmail={peopleByEmail}
            emptyLabel="No caller"
            onChange={(value) => void onPatch(record.id, { caller_email: value })}
          />
        </div>
      ) : null}

      {/* Responsible Enroll (labeled "Assignee" for Medicare) */}
      {has("responsible") ? (
        <div style={{ width: colWidth(columns, "responsible") }} className="flex shrink-0 items-center px-3 py-2.5">
          <EnrollmentPersonMenu
            value={record.responsible_enroll_email}
            peopleByEmail={peopleByEmail}
            emptyLabel="Unassigned"
            onChange={(value) =>
              void onPatch(record.id, { responsible_enroll_email: value })
            }
          />
        </div>
      ) : null}

      {/* Payment status — ACA only */}
      {has("payment") ? (
        <div style={{ width: colWidth(columns, "payment") }} className="flex shrink-0 items-center px-3 py-2.5">
          <EnrollmentOptionMenu
            optionId={record.payment_status_id}
            options={optionsBySet.payment_status}
            emptyLabel="No payment"
            onChange={(value) => void onPatch(record.id, { payment_status_id: value })}
          />
        </div>
      ) : null}

      {/* Carrier */}
      {has("carrier") ? (
        <div style={{ width: colWidth(columns, "carrier") }} className="flex shrink-0 items-center px-3 py-2.5">
          <EnrollmentOptionMenu
            optionId={record.carrier_id}
            options={optionsBySet.carrier}
            emptyLabel="No carrier"
            onChange={(value) => void onPatch(record.id, { carrier_id: value })}
          />
        </div>
      ) : null}

      {/* AC (ACA account status) — ACA only */}
      {has("aca") ? (
        <div style={{ width: colWidth(columns, "aca") }} className="flex shrink-0 items-center px-3 py-2.5">
          <EnrollmentOptionMenu
            optionId={record.aca_status_id}
            options={optionsBySet.aca_status}
            emptyLabel="No AC status"
            onChange={(value) => void onPatch(record.id, { aca_status_id: value })}
          />
        </div>
      ) : null}

      {/* Consent — ACA only; Yes/Not Yet is a binary field, so it's a tick box. */}
      {has("consent") ? (
        <div style={{ width: colWidth(columns, "consent") }} className="flex shrink-0 items-center justify-center px-2 py-2.5">
          <EnrollmentConsentToggle
            optionId={record.consent_id}
            options={optionsBySet.consent}
            onChange={(value) => void onPatch(record.id, { consent_id: value })}
          />
        </div>
      ) : null}

      {/* Platform — ACA only */}
      {has("platform") ? (
        <div style={{ width: colWidth(columns, "platform") }} className="flex shrink-0 items-center px-3 py-2.5">
          <EnrollmentOptionMenu
            optionId={record.platform_id}
            options={optionsBySet.platform}
            emptyLabel="No platform"
            onChange={(value) => void onPatch(record.id, { platform_id: value })}
          />
        </div>
      ) : null}

      {/* PCP 2025 (labeled "PCP" for Medicare, which has a single PCP field) */}
      {has("pcp2025") ? (
        <div style={{ width: colWidth(columns, "pcp2025") }} className="flex shrink-0 items-center px-3 py-2.5">
          <button
            type="button"
            onClick={() => onOpen(record.id)}
            className="min-w-0 truncate text-left text-xs font-medium text-[#42526e] hover:text-[#0c66e4]"
            title={record.pcp_2025 ?? undefined}
          >
            {record.pcp_2025 || <span className="text-[#97a0af]">-</span>}
          </button>
        </div>
      ) : null}

      {/* PCP 2026 — ACA only */}
      {has("pcp2026") ? (
        <div style={{ width: colWidth(columns, "pcp2026") }} className="flex shrink-0 items-center px-3 py-2.5">
          <button
            type="button"
            onClick={() => onOpen(record.id)}
            className="min-w-0 truncate text-left text-xs font-medium text-[#42526e] hover:text-[#0c66e4]"
            title={record.pcp_2026 ?? undefined}
          >
            {record.pcp_2026 || <span className="text-[#97a0af]">-</span>}
          </button>
        </div>
      ) : null}

      {/* Due Date */}
      {has("due") ? (
        <div
          style={{ width: colWidth(columns, "due") }}
          className={`flex shrink-0 items-center px-3 py-2.5 text-xs font-medium ${
            risk.tone === "danger"
              ? "text-[#bf2600]"
              : risk.tone === "warning"
                ? "text-[#b76e00]"
                : "text-[#6b778c]"
          }`}
          title={record.due_date ? `Due ${formatDateShort(record.due_date)}` : "No due date"}
        >
          {record.due_date ? formatDateShort(record.due_date) : "-"}
        </div>
      ) : null}

      {/* FUB Link */}
      {has("fub") ? (
        <div style={{ width: colWidth(columns, "fub") }} className="flex shrink-0 items-center justify-center px-2 py-2.5">
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
        <div style={{ width: colWidth(columns, "createdBy") }} className="flex shrink-0 items-center px-3 py-2.5">
          <span className="truncate text-xs font-medium text-[#42526e]">
            {personLabel(record.created_by_email, peopleByEmail)}
          </span>
        </div>
      ) : null}

      {/* Created time */}
      {has("createdAt") ? (
        <div style={{ width: colWidth(columns, "createdAt") }} className="flex shrink-0 items-center px-3 py-2.5">
          <RelativeTime
            value={record.created_at}
            className="truncate text-xs font-medium text-[#6b778c]"
          />
        </div>
      ) : null}

      {/* Last edited by */}
      {has("updatedBy") ? (
        <div style={{ width: colWidth(columns, "updatedBy") }} className="flex shrink-0 items-center px-3 py-2.5">
          <span className="truncate text-xs font-medium text-[#42526e]">
            {record.updated_by_email
              ? personLabel(record.updated_by_email, peopleByEmail)
              : "-"}
          </span>
        </div>
      ) : null}

      {/* Last edited time */}
      {has("updated") ? (
        <div style={{ width: colWidth(columns, "updated") }} className="flex shrink-0 items-center px-3 py-2.5">
          <RelativeTime
            value={record.updated_at}
            className="truncate text-xs font-medium text-[#6b778c]"
          />
        </div>
      ) : null}

      {/* QC — sticky at the far right */}
      <div
        style={cellStyle(columns[columns.length - 1])}
        className={`sticky z-[1] flex shrink-0 items-center justify-center border-l border-[#dfe1e6] px-2 py-2.5 bg-white group-hover:bg-[#f7f8f9]`}
      >
        <QCCheckButton
          record={record}
          stage={stage}
          onToggle={() => onPatch(record.id, { qc_checked: !record.qc_checked_at })}
        />
      </div>
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
  onChange,
}: {
  optionId: string | null;
  options: EnrollmentOption[];
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
      onClick={(event) => {
        event.stopPropagation();
        onChange(checked ? otherOption.id : yesOption.id);
      }}
      aria-label={`Consent: ${label}`}
      aria-pressed={checked}
      title={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-[#42526e] transition hover:bg-[#f4f5f7] hover:text-[#172b4d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#deebff]"
    >
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-2 transition ${
          checked ? "border-[#00875a] bg-[#00875a]" : "border-[#c1c7d0] bg-white"
        }`}
      >
        {checked ? <Check className="h-3 w-3 text-white" /> : null}
      </span>
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
  onChange,
}: {
  optionId: string | null;
  options: EnrollmentOption[];
  emptyLabel: string;
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
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-expanded={isOpen}
        title={option?.label ?? emptyLabel}
        className="flex w-full min-w-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium"
        style={{ backgroundColor: option ? style.bg : "transparent", color: option ? style.fg : "#97a0af" }}
      >
        <span className="min-w-0 flex-1 truncate text-left">{option?.label ?? emptyLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
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
  onChange,
}: {
  value: string | null;
  peopleByEmail: Map<string, string>;
  emptyLabel: string;
  onChange: (value: string | null) => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, setIsOpen } =
    useAnchoredMenu();
  const options = [...peopleByEmail.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const selectedLabel = value
    ? peopleByEmail.get(value) ?? formatEmailAsName(value)
    : emptyLabel;

  return (
    <span className="block min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-expanded={isOpen}
        title={selectedLabel}
        className="flex w-full min-w-0 items-center"
      >
        {value ? (
          <span className="flex min-w-0 items-center gap-1.5 text-left text-xs font-semibold text-[#42526e] transition hover:text-[#0c66e4]">
            <Initials email={value} label={selectedLabel} />
            <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff]">
            <UserPlus className="h-3 w-3" />
            Assign
          </span>
        )}
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
              {options.map(([email, name]) => (
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
                  <span className="min-w-0 truncate">{name}</span>
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
  onToggle,
}: {
  record: EnrollmentRecordWithStats;
  stage: EnrollmentOption | null;
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
      onClick={(event) => {
        event.stopPropagation();
        void onToggle();
      }}
      className={`${className} transition hover:brightness-95`}
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
  onChange,
}: {
  stageId: string | null;
  stages: EnrollmentOption[];
  onChange: (stageId: string) => Promise<void>;
}) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const stage = stageId ? stages.find((option) => option.id === stageId) ?? null : null;
  const style = optionPillStyle(stage);
  const label = stage?.label ?? "No stage";
  const pill = (
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
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-expanded={isOpen}
        title={label}
        className="block w-full min-w-0"
      >
        {pill}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="z-[100] overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
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
  mentionMembers,
  optionsById,
  optionsBySet,
  currentEmail,
  onClose,
  onPatch,
  onArchive,
}: {
  record: EnrollmentRecordWithStats;
  peopleByEmail: Map<string, string>;
  mentionMembers: TaskAssignee[];
  optionsById: Map<string, EnrollmentOption>;
  optionsBySet: EnrollmentOptionsBySet;
  currentEmail: string;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<EnrollmentDetail | null>(null);
  const [tab, setTab] = useState<"comments" | "activity" | "files">("comments");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
  const reopenTarget = getReopenStage(stage, optionsBySet.stage);
  const fubHref = record.fub_link ? formatExternalLink(record.fub_link) : null;
  // Medicare's real data has no Payment/Consent/Platform/AC concepts and a
  // single Assignee + PCP field — see enrollmentColumnsForProgram() for the
  // list-view equivalent of this same trim.
  const isMedicare = record.program === "medicare";

  const reload = useCallback(async () => {
    const response = await fetch(`/api/enrollment/${record.id}/detail`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    setDetail((await response.json()) as EnrollmentDetail);
  }, [record.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDetail(null);
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  function reopen() {
    if (!reopenTarget) return;
    const reason = window.prompt(`Reason to reopen to ${reopenTarget.label}`);
    if (!reason?.trim()) return;
    void onPatch({ stage_id: reopenTarget.id, reopen_reason: reason.trim() });
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
          <span className="flex items-center gap-2.5">
            <span className="font-mono text-sm font-bold text-[#97a0af]">
              {enrollmentKey(record.id)}
            </span>
            {stage ? (
              <span
                className="rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: optionPillStyle(stage).bg,
                  color: optionPillStyle(stage).fg,
                }}
              >
                {stage.label}
              </span>
            ) : null}
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

        <div className="flex-1 overflow-y-auto">
          <div className="grid min-h-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
            <main className="min-w-0 space-y-6 p-5 lg:p-7">
              <label className="block space-y-1.5">
                <span className={LABEL_CLASS}>Client</span>
                <EditableInput
                  value={record.client_name ?? ""}
                  placeholder="Client name"
                  className={`${INPUT_CLASS} h-11 text-base font-semibold`}
                  onSave={(value) => onPatch({ client_name: value })}
                />
              </label>

              <label className="block space-y-1.5">
                <span className={LABEL_CLASS}>FUB Link</span>
                <div className="flex gap-1.5">
                  <EditableInput
                    value={record.fub_link ?? ""}
                    placeholder="No FUB link"
                    className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
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

              <section className="space-y-3 border-t border-[#dfe1e6] pt-5">
              <div className="flex flex-wrap gap-1 rounded bg-[#f4f5f7] p-1">
                <DrawerTab active={tab === "comments"} onClick={() => setTab("comments")}>
                  Comments ({detail?.comments.length ?? record.comment_count})
                </DrawerTab>
                <DrawerTab active={tab === "activity"} onClick={() => setTab("activity")}>
                  Activity ({detail?.activity.length ?? 0})
                </DrawerTab>
                <DrawerTab active={tab === "files"} onClick={() => setTab("files")}>
                  Files ({detail?.attachments.length ?? record.attachment_count})
                </DrawerTab>
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
                  onReload={reload}
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
                  canEdit
                  onReload={reload}
                />
              )}
            </section>
          </main>

          <aside className="space-y-5 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0">
            <SidebarSection title="Pipeline">
              <FieldBlock label="Stage">
                <EnrollmentStagePill
                  stageId={record.stage_id}
                  stages={optionsBySet.stage}
                  onChange={(value) => onPatch({ stage_id: value })}
                />
              </FieldBlock>

              <FieldBlock label="Due date">
                <input
                  type="date"
                  value={formatDateInput(record.due_date)}
                  onChange={(event) =>
                    void onPatch({ due_date: event.target.value || null })
                  }
                  className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
                />
              </FieldBlock>
            </SidebarSection>

            <SidebarSection title={isMedicare ? "Plan" : "Plan & payment"}>
              {!isMedicare ? (
                <FieldBlock label="Payment">
                  <EnrollmentOptionMenu
                    optionId={record.payment_status_id}
                    options={optionsBySet.payment_status}
                    emptyLabel="No payment"
                    onChange={(value) => void onPatch({ payment_status_id: value })}
                  />
                </FieldBlock>
              ) : null}

              <FieldBlock label="Carrier">
                <EnrollmentOptionMenu
                  optionId={record.carrier_id}
                  options={optionsBySet.carrier}
                  emptyLabel="No carrier"
                  onChange={(value) => void onPatch({ carrier_id: value })}
                />
              </FieldBlock>

              {!isMedicare ? (
                <>
                  <FieldBlock label="AC">
                    <EnrollmentOptionMenu
                      optionId={record.aca_status_id}
                      options={optionsBySet.aca_status}
                      emptyLabel="No AC status"
                      onChange={(value) => void onPatch({ aca_status_id: value })}
                    />
                  </FieldBlock>

                  <FieldBlock label="Consent">
                    <EnrollmentConsentToggle
                      optionId={record.consent_id}
                      options={optionsBySet.consent}
                      onChange={(value) => void onPatch({ consent_id: value })}
                    />
                  </FieldBlock>

                  <FieldBlock label="Platform">
                    <EnrollmentOptionMenu
                      optionId={record.platform_id}
                      options={optionsBySet.platform}
                      emptyLabel="No platform"
                      onChange={(value) => void onPatch({ platform_id: value })}
                    />
                  </FieldBlock>
                </>
              ) : null}
            </SidebarSection>

            <SidebarSection title="Ownership">
              {!isMedicare ? (
                <FieldBlock label="Caller">
                  <EnrollmentPersonMenu
                    value={record.caller_email}
                    peopleByEmail={peopleByEmail}
                    emptyLabel="No caller"
                    onChange={(value) => void onPatch({ caller_email: value })}
                  />
                </FieldBlock>
              ) : null}

              <FieldBlock label={isMedicare ? "Assignee" : "Responsible enroll"}>
                <EnrollmentPersonMenu
                  value={record.responsible_enroll_email}
                  peopleByEmail={peopleByEmail}
                  emptyLabel="Unassigned"
                  onChange={(value) =>
                    void onPatch({ responsible_enroll_email: value })
                  }
                />
              </FieldBlock>
            </SidebarSection>

            <SidebarSection title="PCP">
              <FieldBlock label={isMedicare ? "PCP" : "PCP 2025"}>
                <EditableInput
                  value={record.pcp_2025 ?? ""}
                  placeholder={isMedicare ? "No PCP" : "No PCP 2025"}
                  className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
                  onSave={(value) => onPatch({ pcp_2025: value })}
                />
              </FieldBlock>

              {!isMedicare ? (
                <FieldBlock label="PCP 2026">
                  <EditableInput
                    value={record.pcp_2026 ?? ""}
                    placeholder="No PCP 2026"
                    className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
                    onSave={(value) => onPatch({ pcp_2026: value })}
                  />
                </FieldBlock>
              ) : null}
            </SidebarSection>

            <div className="space-y-3">
              <FieldBlock label="QC Review">
                <EnrollmentQCPanel
                  record={record}
                  stage={stage}
                  peopleByEmail={peopleByEmail}
                  onToggle={() => onPatch({ qc_checked: !record.qc_checked_at })}
                />
              </FieldBlock>
            </div>

            {stage?.is_terminal && reopenTarget ? (
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

            <div className="rounded-lg border border-[#dfe1e6] bg-white p-3 text-xs font-semibold text-[#6b778c]">
              <div>Created by {personLabel(record.created_by_email, peopleByEmail)}</div>
              <div className="mt-1">Created {formatStableDateTime(record.created_at)}</div>
              <div className="mt-1">
                Updated {record.updated_by_email ? `by ${personLabel(record.updated_by_email, peopleByEmail)} ` : ""}
                <RelativeTime value={record.updated_at} />
              </div>
            </div>

            <div className="border-t border-[#dfe1e6] pt-3">
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                className="text-sm font-semibold text-[#bf2600] transition hover:underline"
              >
                Archive record
              </button>
            </div>
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
    </div>
  );
}

function NewEnrollmentDialog({
  program,
  people,
  optionsBySet,
  currentEmail,
  onClose,
  onCreate,
}: {
  program: EnrollmentProgram;
  people: EnrollmentPerson[];
  optionsBySet: EnrollmentOptionsBySet;
  currentEmail: string;
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const isMedicare = program === "medicare";
  const [form, setForm] = useState<Record<string, string>>({
    client_name: "",
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
    caller_email: isMedicare ? "" : currentEmail,
    responsible_enroll_email: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(field: string, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit() {
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
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#d8dee8] px-5 py-3">
          <h2 className="text-lg font-bold text-[#172b4d]">New enrollment</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1.5 text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormInput label="Client name" value={form.client_name} onChange={(value) => update("client_name", value)} />
            <FormInput label="FUB link" value={form.fub_link} onChange={(value) => update("fub_link", value)} />
            <FormSelect label="Stage" value={form.stage_id} options={selectOptions(optionsBySet.stage)} onChange={(value) => update("stage_id", value)} />
            {!isMedicare ? (
              <FormSelect label="Caller" value={form.caller_email} options={peopleOptions(people)} onChange={(value) => update("caller_email", value)} />
            ) : null}
            <FormSelect
              label={isMedicare ? "Assignee" : "Responsible enroll"}
              value={form.responsible_enroll_email}
              options={peopleOptions(people)}
              onChange={(value) => update("responsible_enroll_email", value)}
            />
            <FormInput label="Due date" type="date" value={form.due_date} onChange={(value) => update("due_date", value)} />
            {!isMedicare ? (
              <FormSelect label="Payment" value={form.payment_status_id} options={selectOptions(optionsBySet.payment_status)} onChange={(value) => update("payment_status_id", value)} />
            ) : null}
            <FormSelect label="Carrier" value={form.carrier_id} options={selectOptions(optionsBySet.carrier)} onChange={(value) => update("carrier_id", value)} />
            {!isMedicare ? (
              <>
                <FormSelect label="ACA" value={form.aca_status_id} options={selectOptions(optionsBySet.aca_status)} onChange={(value) => update("aca_status_id", value)} />
                <FormSelect label="Consent" value={form.consent_id} options={selectOptions(optionsBySet.consent)} onChange={(value) => update("consent_id", value)} />
                <FormSelect label="Platform" value={form.platform_id} options={selectOptions(optionsBySet.platform)} onChange={(value) => update("platform_id", value)} />
              </>
            ) : null}
            <FormInput label={isMedicare ? "PCP" : "PCP 2025"} value={form.pcp_2025} onChange={(value) => update("pcp_2025", value)} />
            {!isMedicare ? (
              <FormInput label="PCP 2026" value={form.pcp_2026} onChange={(value) => update("pcp_2026", value)} />
            ) : null}
          </div>
          {error ? (
            <div className="mt-4 rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-bold text-[#bf2600]">
              {error}
            </div>
          ) : null}
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
            disabled={saving || (!form.client_name.trim() && !form.fub_link.trim())}
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

function OptionSetManager({
  program,
  optionSets,
  optionsBySet,
  optionUsageCounts,
  onClose,
  onChanged,
}: {
  program: EnrollmentProgram;
  optionSets: EnrollmentOptionSet[];
  optionsBySet: EnrollmentOptionsBySet;
  optionUsageCounts: Map<string, number>;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [setKey, setSetKey] = useState<EnrollmentOptionSetKey>("stage");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#0C66E4");
  const [isTerminal, setIsTerminal] = useState(false);
  const [triggersQc, setTriggersQc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<EnrollmentOption | null>(null);
  const setOptions = sortEnrollmentOptionsByLabel(optionsBySet[setKey]);

  async function addOption() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/enrollment/option-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program,
          set_key: setKey,
          label,
          color,
          is_terminal: isTerminal,
          triggers_qc: triggersQc,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Could not add option.");
      setLabel("");
      setIsTerminal(false);
      setTriggersQc(false);
      await onChanged();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add option.");
    } finally {
      setBusy(false);
    }
  }

  async function patchOption(id: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/enrollment/option-sets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (response.ok) await onChanged();
  }

  async function archiveOption(id: string) {
    const response = await fetch(`/api/enrollment/option-sets/${id}`, {
      method: "DELETE",
    });
    if (response.ok) await onChanged();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#091e42]/40 p-4">
      <div className="flex h-[calc(100vh-2rem)] max-h-[760px] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="shrink-0 flex items-center justify-between border-b border-[#d8dee8] px-5 py-3">
          <div>
            <h2 className="text-lg font-bold text-[#172b4d]">
              {program === "medicare" ? "Medicare option sets" : "ACA option sets"}
            </h2>
            <p className="text-sm font-medium text-[#6b778c]">
              Archive options instead of deleting them from historical records.
            </p>
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
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="overflow-y-auto border-b border-[#d8dee8] bg-[#f7f8fa] p-3 md:border-b-0 md:border-r">
            {optionSets.map((set) => (
              <button
                key={set.id}
                type="button"
                onClick={() => setSetKey(set.key)}
                className={`mb-1 flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm font-bold transition ${
                  set.key === setKey
                    ? "bg-[#e9f2ff] text-[#0c66e4]"
                    : "text-[#42526e] hover:bg-white"
                }`}
              >
                {set.label}
                <span>{optionsBySet[set.key].length}</span>
              </button>
            ))}
          </nav>
          <section className="flex min-h-0 flex-col p-4">
            <div className="shrink-0 grid grid-cols-1 gap-2 border-b border-[#d8dee8] pb-4 md:grid-cols-[minmax(0,1fr)_110px_120px_120px_auto]">
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={`New ${ENROLLMENT_OPTION_LABELS[setKey]}`}
                className="h-10 rounded border border-[#d8dee8] px-3 text-sm font-semibold outline-none focus:border-[#0c66e4]"
              />
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-10 w-full rounded border border-[#d8dee8] bg-white p-1"
              />
              <label className="flex items-center justify-center gap-2 rounded border border-[#d8dee8] px-2 text-xs font-bold text-[#42526e]">
                <input
                  type="checkbox"
                  disabled={setKey !== "stage"}
                  checked={setKey === "stage" && isTerminal}
                  onChange={(event) => setIsTerminal(event.target.checked)}
                />
                Terminal
              </label>
              <label className="flex items-center justify-center gap-2 rounded border border-[#d8dee8] px-2 text-xs font-bold text-[#42526e]">
                <input
                  type="checkbox"
                  disabled={setKey !== "stage"}
                  checked={setKey === "stage" && triggersQc}
                  onChange={(event) => setTriggersQc(event.target.checked)}
                />
                QC
              </label>
              <button
                type="button"
                disabled={busy || !label.trim()}
                onClick={() => void addOption()}
                className="h-10 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white transition hover:bg-[#0055cc] disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {error ? (
              <div className="mt-3 shrink-0 rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-bold text-[#bf2600]">
                {error}
              </div>
            ) : null}
            <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-lg border border-[#d8dee8]">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-[#f7f8fa] text-xs font-bold uppercase tracking-wide text-[#6b778c]">
                  <tr>
                    <th className="border-b border-r border-[#d8dee8] px-3 py-2 text-left">Label</th>
                    <th className="border-b border-r border-[#d8dee8] px-3 py-2 text-left">Color</th>
                    <th className="border-b border-r border-[#d8dee8] px-3 py-2 text-left">Rules</th>
                    <th className="border-b border-[#d8dee8] px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {setOptions.map((option) => (
                    <tr key={option.id}>
                      <td className="border-b border-r border-[#d8dee8] px-3 py-2">
                        <input
                          defaultValue={option.label}
                          onBlur={(event) => {
                            const value = event.target.value.trim();
                            if (value && value !== option.label) {
                              void patchOption(option.id, { label: value });
                            }
                          }}
                          className="h-8 w-full rounded border border-[#d8dee8] px-2 font-semibold text-[#172b4d] outline-none focus:border-[#0c66e4]"
                        />
                      </td>
                      <td className="border-b border-r border-[#d8dee8] px-3 py-2">
                        <input
                          type="color"
                          defaultValue={option.color ?? "#97A0AF"}
                          onBlur={(event) => void patchOption(option.id, { color: event.target.value })}
                          className="h-8 w-full rounded border border-[#d8dee8] bg-white p-1"
                        />
                      </td>
                      <td className="border-b border-r border-[#d8dee8] px-3 py-2 text-xs font-semibold text-[#42526e]">
                        {setKey === "stage" ? (
                          <div className="flex flex-wrap gap-2">
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={option.is_terminal}
                                onChange={(event) =>
                                  void patchOption(option.id, {
                                    is_terminal: event.target.checked,
                                  })
                                }
                              />
                              Terminal
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={option.triggers_qc}
                                onChange={(event) =>
                                  void patchOption(option.id, {
                                    triggers_qc: event.target.checked,
                                  })
                                }
                              />
                              QC
                            </label>
                          </div>
                        ) : (
                          "Standard option"
                        )}
                      </td>
                      <td className="border-b border-[#d8dee8] px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setConfirmArchive(option)}
                          className="text-xs font-bold text-[#bf2600] transition hover:underline"
                        >
                          Archive
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {confirmArchive ? (
        <ConfirmDialog
          title={`Archive "${confirmArchive.label}"?`}
          description={
            (optionUsageCounts.get(confirmArchive.id) ?? 0) > 0
              ? `${optionUsageCounts.get(confirmArchive.id)} record(s) currently use this option. Archiving removes it from pickers going forward — those records keep showing it, but nobody can select it for a new record until it's restored.`
              : "No live records currently use this option. It will be removed from pickers going forward."
          }
          confirmLabel="Archive"
          onCancel={() => setConfirmArchive(null)}
          onConfirm={() => {
            const id = confirmArchive.id;
            setConfirmArchive(null);
            void archiveOption(id);
          }}
        />
      ) : null}
    </div>
  );
}

function EditableInput({
  value,
  placeholder,
  className = `${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`,
  onSave,
}: {
  value: string;
  placeholder: string;
  className?: string;
  onSave: (value: string | null) => Promise<void>;
}) {
  return (
    <input
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next !== value.trim()) void onSave(next || null);
      }}
      className={className}
    />
  );
}

function EnrollmentQCPanel({
  record,
  stage,
  peopleByEmail,
  onToggle,
}: {
  record: EnrollmentRecordWithStats;
  stage: EnrollmentOption | null;
  peopleByEmail: Map<string, string>;
  onToggle: () => Promise<void>;
}) {
  const reviewed = Boolean(record.qc_checked_at);
  const required = Boolean(stage?.triggers_qc);
  const reviewerLabel = record.qc_checked_by_email
    ? personLabel(record.qc_checked_by_email, peopleByEmail)
    : null;

  return (
    <div className="rounded-lg border border-[#dfe1e6] bg-white p-3">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 shrink-0 ${
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
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#172b4d]">
            {reviewed
              ? "QC checked"
              : required
                ? "Needs enroll QC"
                : "No QC required"}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-[#626f86]">
            {!required
              ? "Available after this record reaches a QC stage."
              : reviewed
                ? `Checked by ${reviewerLabel ?? "unknown"}${record.qc_checked_at ? ` on ${new Date(record.qc_checked_at).toLocaleString()}` : ""}.`
                : "Awaiting enrollment QC verification."}
          </p>
        </div>
      </div>

      <button
        type="button"
        disabled={!required}
        onClick={() => void onToggle()}
        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded bg-[#0c66e4] px-3 text-xs font-semibold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:bg-[#dfe1e6] disabled:text-[#6b778c]"
      >
        {reviewed ? "Clear QC check" : "Mark QC checked"}
      </button>
    </div>
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
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm font-bold transition ${
        active
          ? "bg-white text-[#0c66e4] shadow-sm"
          : "text-[#42526e] hover:text-[#172b4d]"
      }`}
    >
      {children}
    </button>
  );
}

// Groups related sidebar fields under a small heading so the drawer reads as
// a few clusters (Pipeline / Plan / Ownership / PCP) instead of one long,
// undifferentiated stack of boxes.
function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 border-t border-[#dfe1e6] pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[10.5px] font-bold uppercase tracking-wide text-[#8993a4]">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      {children}
    </div>
  );
}

function FormInput({
  label,
  value,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-[#d8dee8] bg-white px-3 text-sm font-semibold text-[#172b4d] outline-none focus:border-[#0c66e4] focus:ring-2 focus:ring-[#deebff]"
      />
    </label>
  );
}

function FormSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-[#d8dee8] bg-white px-3 text-sm font-semibold text-[#172b4d] outline-none focus:border-[#0c66e4] focus:ring-2 focus:ring-[#deebff]"
      >
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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
  optionsById: Map<string, EnrollmentOption>
) {
  const query = filters.query.trim().toLowerCase();
  return records.filter((record) => {
    const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
    if (filters.attention && !enrollmentNeedsAttention(record, optionsById)) return false;
    if (filters.overdue && !enrollmentIsOverdue(record)) return false;
    if (filters.qcNeeded && !(stage?.triggers_qc && !record.qc_checked_at)) return false;
    const hasCaller = record.program === "medicare" || Boolean(record.caller_email);
    if (filters.unowned && hasCaller && record.responsible_enroll_email) {
      return false;
    }
    if (filters.stage.length > 0 && !filters.stage.includes(record.stage_id ?? "")) return false;
    if (filters.caller.length > 0 && !filters.caller.includes(record.caller_email ?? "")) return false;
    if (
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
    if (filters.dueFrom && (!record.due_date || record.due_date < filters.dueFrom)) return false;
    if (filters.dueTo && (!record.due_date || record.due_date > filters.dueTo)) return false;
    if (!query) return true;

    const haystack = [
      record.client_name ?? "",
      record.comment_search_text ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
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
  optionsById: Map<string, EnrollmentOption>,
  now = new Date()
): boolean {
  const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
  if (record.closed_at) return Boolean(stage?.triggers_qc && !record.qc_checked_at);
  // Medicare has no Caller role (always null by design) — only ACA should
  // treat a missing caller as a real "nobody owns this" signal.
  const missingCaller = record.program !== "medicare" && !record.caller_email;
  return (
    enrollmentIsOverdue(record, now) ||
    enrollmentIsDueSoon(record, now) ||
    Boolean(stage?.triggers_qc && !record.qc_checked_at) ||
    missingCaller ||
    !record.responsible_enroll_email ||
    !record.due_date
  );
}

function enrollmentRisk(
  record: EnrollmentRecordWithStats,
  stage: EnrollmentOption | null
): {
  label: string;
  tone: "danger" | "warning" | "info" | "neutral" | "ok";
} {
  if (enrollmentIsOverdue(record)) {
    return { label: "Overdue", tone: "danger" };
  }
  if (enrollmentIsDueSoon(record)) {
    return { label: "Due soon", tone: "warning" };
  }
  if (stage?.triggers_qc && !record.qc_checked_at) {
    return { label: "QC needed", tone: "info" };
  }
  if (!record.responsible_enroll_email || (record.program !== "medicare" && !record.caller_email)) {
    return { label: "Missing owner", tone: "warning" };
  }
  if (!record.due_date && !record.closed_at) {
    return { label: "No due date", tone: "neutral" };
  }
  return { label: "Healthy", tone: "ok" };
}

function enrollmentAttentionScore(
  record: EnrollmentRecordWithStats,
  optionsById: Map<string, EnrollmentOption>
): number {
  const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
  if (record.closed_at && !(stage?.triggers_qc && !record.qc_checked_at)) return 0;

  let score = 0;
  if (enrollmentIsOverdue(record)) score += 1000;
  if (enrollmentIsDueSoon(record)) score += 800;
  if (stage?.triggers_qc && !record.qc_checked_at) score += 700;
  if (!record.responsible_enroll_email) score += 500;
  if (record.program !== "medicare" && !record.caller_email) score += 400;
  if (!record.due_date) score += 300;
  if (record.due_date) {
    const dueDistance = Math.max(
      0,
      new Date(`${record.due_date}T23:59:59.999`).getTime() - Date.now()
    );
    score += Math.max(0, 100 - Math.floor(dueDistance / 86_400_000));
  }
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

function finalizeEnrollmentDateRange(from: string, to: string) {
  if (!from && !to) return { from: "", to: "" };
  if (from && !to) return { from, to: from };
  if (!from && to) return { from: to, to };
  if (from.localeCompare(to) > 0) return { from: to, to: from };
  return { from, to };
}

function formatEnrollmentDateRangeLabel(from: string, to: string) {
  if (!from && !to) return "All due dates";
  if (from && to) return formatEnrollmentCompactDateRangeLabel(from, to);
  if (from) return `From ${formatEnrollmentDateLabel(from)}`;
  return `Through ${formatEnrollmentDateLabel(to)}`;
}

function formatEnrollmentCompactDateRangeLabel(from: string, to: string) {
  if (from === to) return formatEnrollmentDateLabel(from);

  const start = dateKeyToLocalDate(from);
  const end = dateKeyToLocalDate(to);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${formatEnrollmentMonthDay(from)} - ${end.getDate()}, ${end.getFullYear()}`;
  }

  if (sameYear) {
    return `${formatEnrollmentMonthDay(from)} - ${formatEnrollmentMonthDay(to)}, ${end.getFullYear()}`;
  }

  return `${formatEnrollmentDateLabel(from)} - ${formatEnrollmentDateLabel(to)}`;
}

function formatEnrollmentDateLabel(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(dateKeyToLocalDate(value));
}

function formatEnrollmentMonthDay(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(dateKeyToLocalDate(value));
}

function dateKeyToLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
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

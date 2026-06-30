"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import {
  STATUS_LABEL,
  TASK_STATUSES,
  type TaskCategory,
  type TaskStatus,
} from "@/lib/tasks/types";
import { ALL_AGENTS, NO_ASSIGNEE, type QuickFilter } from "@/lib/tasks/filtering";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { TaskSelect } from "./TaskSelect";

export type BoardView = "board" | "list" | "backlog";

export type TaskDateRangeValue = { from: string; to: string };

export type TaskDatePresetKey =
  | "fixed"
  | "today"
  | "yesterday"
  | "thisMonth"
  | "last7"
  | "last14"
  | "last30"
  | "all";

export type TaskDateRangeDefault = TaskDateRangeValue & {
  preset: TaskDatePresetKey;
};

export type AgentStat = {
  key: string;
  label: string;
  total: number;
  active: number;
  waiting: number;
  done: number;
  urgent: number;
};

// One-click smart views. Each maps to a `matchesQuick` rule; multiple combine (AND).
const PRESETS: { key: QuickFilter; label: string; managerOnly?: boolean }[] = [
  { key: "mine", label: "My tasks", managerOnly: true },
  { key: "highPriority", label: "High priority" },
  { key: "recentlyUpdated", label: "Recently updated" },
];

export function TaskToolbar({
  view,
  onViewChange,
  isManager,
  query,
  onQuery,
  agentStats,
  agentFilter,
  onAgentFilter,
  assignees,
  assigneeFilter,
  onAssigneeFilter,
  presets,
  onPresets,
  category,
  onCategory,
  status,
  onStatus,
  dateFrom,
  dateTo,
  defaultDateRange,
  onDateRange,
  onDefaultDateRange,
  showAgent,
  showAssignee,
  showStatus,
  categories,
  resultCount,
  totalCount,
  onClearAll,
}: {
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  isManager: boolean;
  query: string;
  onQuery: (value: string) => void;
  agentStats: AgentStat[];
  agentFilter: string[];
  onAgentFilter: (agent: string[]) => void;
  assignees: TaskAssignee[];
  assigneeFilter: string[];
  onAssigneeFilter: (assignee: string[]) => void;
  presets: QuickFilter[];
  onPresets: (value: QuickFilter[]) => void;
  category: string[];
  onCategory: (value: string[]) => void;
  status: TaskStatus[];
  onStatus: (value: TaskStatus[]) => void;
  dateFrom: string;
  dateTo: string;
  defaultDateRange: TaskDateRangeValue;
  onDateRange: (value: TaskDateRangeValue) => void;
  onDefaultDateRange: (value: TaskDateRangeDefault) => void;
  showAgent: boolean;
  showAssignee: boolean;
  showStatus: boolean;
  categories: TaskCategory[];
  resultCount: number;
  totalCount: number;
  onClearAll: () => void;
}) {
  const agentOptions = [
    { value: ALL_AGENTS, label: "Agent" },
    ...agentStats.map((s) => ({ value: s.key, label: s.label })),
  ];
  const categoryOptions = [
    { value: "", label: "Category" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];
  const statusOptions = [
    { value: "", label: "Status" },
    ...TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
  ];
  const assigneeOptions = [
    { value: "", label: "Assignee" },
    { value: NO_ASSIGNEE, label: "Unassigned" },
    ...assignees.map((a) => ({ value: a.email, label: a.name ?? a.email })),
  ];

  const presetOptions = PRESETS.filter((p) => !p.managerOnly || isManager);

  const hasActiveFilters =
    query.trim() !== "" ||
    (showAgent && agentFilter.length > 0) ||
    (showAssignee && assigneeFilter.length > 0) ||
    presets.length > 0 ||
    category.length > 0 ||
    (showStatus && status.length > 0) ||
    dateFrom !== defaultDateRange.from ||
    dateTo !== defaultDateRange.to;

  const togglePreset = (key: QuickFilter) =>
    onPresets(
      presets.includes(key) ? presets.filter((p) => p !== key) : [...presets, key]
    );

  const views: { key: BoardView; label: string }[] = [
    { key: "board", label: "Board" },
    { key: "list", label: "List" },
    ...(isManager ? [{ key: "backlog" as const, label: "Backlog" }] : []),
  ];

  return (
    <div className="mt-6 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded bg-[#f4f5f7] p-0.5">
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => onViewChange(v.key)}
              className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                view === v.key
                  ? "bg-white text-[#0c66e4] shadow-sm"
                  : "text-[#44546f] hover:text-[#172b4d]"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <label className="relative block h-10 min-w-[18rem] flex-1 md:min-w-[28rem]">
          <span className="sr-only">Search tasks</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search"
            className="h-full w-full rounded border-2 border-transparent bg-[#f4f5f7] pl-10 pr-3 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#44546f] hover:bg-[#ebecf0] focus:border-[#0c66e4] focus:bg-white"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {showAgent ? (
          <TaskSelect
            multi
            values={agentFilter}
            options={agentOptions}
            placeholder="Agent"
            allValue={ALL_AGENTS}
            summaryLabel="agents"
            className="w-max min-w-[9rem]"
            buttonClassName="h-9 border-[#dfe1e6] shadow-none"
            onValuesChange={onAgentFilter}
          />
        ) : null}

        {showAssignee ? (
          <TaskSelect
            multi
            values={assigneeFilter}
            options={assigneeOptions}
            placeholder="Assignee"
            allValue=""
            summaryLabel="assignees"
            className="w-max min-w-[11rem]"
            buttonClassName="h-9 border-[#dfe1e6] shadow-none"
            onValuesChange={onAssigneeFilter}
          />
        ) : null}

        {showStatus ? (
          <TaskSelect
            multi
            values={status}
            options={statusOptions}
            placeholder="Status"
            allValue=""
            summaryLabel="statuses"
            className="w-max min-w-[10rem]"
            buttonClassName="h-9 border-[#dfe1e6] shadow-none"
            onValuesChange={(values) => onStatus(values as TaskStatus[])}
          />
        ) : null}

        <TaskSelect
          multi
          values={category}
          options={categoryOptions}
          placeholder="Category"
          allValue=""
          summaryLabel="categories"
          className="w-max min-w-[11rem]"
          buttonClassName="h-9 border-[#dfe1e6] shadow-none"
          onValuesChange={onCategory}
        />

        <DateRangeFilter
          from={dateFrom}
          to={dateTo}
          onChange={onDateRange}
          onDefaultChange={onDefaultDateRange}
        />

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={onClearAll}
            className="text-sm font-medium text-[#0c66e4] transition hover:underline"
          >
            Clear all
          </button>
        ) : null}

        <span className="ml-auto text-sm font-medium text-[#626f86]">
          {resultCount} of {totalCount} tasks
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {presetOptions.map((p) => {
          const active = presets.includes(p.key);
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => togglePreset(p.key)}
              aria-pressed={active}
              className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold transition ${
                active
                  ? "border-[#0c66e4] bg-[#deebff] text-[#0c66e4]"
                  : "border-[#dfe1e6] bg-white text-[#42526e] hover:border-[#c1c7d0]"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateRangeFilter({
  from,
  to,
  onChange,
  onDefaultChange,
}: {
  from: string;
  to: string;
  onChange: (value: TaskDateRangeValue) => void;
  onDefaultChange: (value: TaskDateRangeDefault) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draftRange, setDraftRange] = useState({ from, to });
  const [draftPreset, setDraftPreset] = useState<TaskDatePresetKey>(() =>
    getDatePresetForRange(from, to)
  );
  const [visibleStartMonth, setVisibleStartMonth] = useState(() =>
    getVisibleDateMonths(from, to).startMonth
  );
  const [visibleEndMonth, setVisibleEndMonth] = useState(() =>
    getVisibleDateMonths(from, to).endMonth
  );

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const normalizedDraftRange = useMemo(
    () => normalizeDateRange(draftRange.from, draftRange.to),
    [draftRange.from, draftRange.to]
  );

  const label = useMemo(() => formatDateRangeLabel(from, to), [from, to]);

  function selectStartDate(dateKey: string) {
    setDraftPreset("fixed");
    setDraftRange((current) => {
      if (current.to && dateKey.localeCompare(current.to) > 0) {
        return { from: dateKey, to: dateKey };
      }

      return { ...current, from: dateKey };
    });
  }

  function selectEndDate(dateKey: string) {
    setDraftPreset("fixed");
    setDraftRange((current) => {
      if (current.from && current.from.localeCompare(dateKey) > 0) {
        return { from: dateKey, to: dateKey };
      }

      return { ...current, to: dateKey };
    });
  }

  function applyRange() {
    onChange(finalizeDateRange(draftRange.from, draftRange.to));
    setIsOpen(false);
  }

  function saveDefaultRange() {
    const nextRange = finalizeDateRange(draftRange.from, draftRange.to);
    const nextPreset =
      nextRange.from || nextRange.to ? draftPreset : ("all" as const);

    onDefaultChange({ ...nextRange, preset: nextPreset });
    onChange(nextRange);
    setIsOpen(false);
  }

  function selectPreset(presetKey: TaskDatePresetKey) {
    setDraftPreset(presetKey);

    if (presetKey === "fixed") {
      return;
    }

    const nextRange = getPresetDateRange(presetKey);
    setDraftRange(nextRange);
    const nextMonths = getVisibleDateMonths(nextRange.from, nextRange.to);
    setVisibleStartMonth(nextMonths.startMonth);
    setVisibleEndMonth(nextMonths.endMonth);
  }

  function toggleRangePicker() {
    if (!isOpen) {
      setDraftRange({ from, to });
      setDraftPreset(getDatePresetForRange(from, to));
      const nextMonths = getVisibleDateMonths(from, to);
      setVisibleStartMonth(nextMonths.startMonth);
      setVisibleEndMonth(nextMonths.endMonth);
    }

    setIsOpen((current) => !current);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleRangePicker}
        className="dashboard-filter-button h-9 min-w-[13.75rem] !rounded-lg !px-3 !text-sm !font-medium !shadow-[0_1px_2px_rgba(9,30,66,0.06)]"
        aria-expanded={isOpen}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-[#44546f]" />
          <span className="truncate font-medium">{label}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#667085]" />
      </button>

      {isOpen ? (
        <div
          className={`dashboard-filter-menu absolute right-0 z-[110] mt-2.5 p-3 ${
            draftPreset === "fixed"
              ? "w-[min(31.5rem,calc(100vw-1rem))]"
              : "w-[min(17rem,calc(100vw-1rem))]"
          }`}
        >
          <div className={draftPreset === "fixed" ? "mb-3" : ""}>
            <div className="rounded-lg border border-[#dfe1e6] bg-[#f8fafc] p-1">
              {DATE_PRESETS.map((preset) => {
                const active = draftPreset === preset.key;
                const presetRange =
                  preset.key === "fixed"
                    ? normalizedDraftRange
                    : getPresetDateRange(preset.key);
                const presetRangeLabel = formatDateRangeLabel(
                  presetRange.from,
                  presetRange.to
                );

                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => selectPreset(preset.key)}
                    className={`flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition ${
                      active
                        ? "bg-[#155fd1] text-white shadow-sm"
                        : "text-[#344054] hover:bg-white hover:text-[#16233a]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[0.74rem] font-bold leading-4">
                        {preset.label}
                      </span>
                      {preset.key !== "fixed" ? (
                        <span
                          className={`block truncate text-[0.66rem] font-semibold leading-3 ${
                            active ? "text-white/75" : "text-[#6b778c]"
                          }`}
                        >
                          {presetRangeLabel}
                        </span>
                      ) : null}
                    </span>
                    {preset.key === "fixed" ? (
                      <ChevronRight className="h-3 w-3 opacity-70" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {draftPreset === "fixed" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <DatePanel
                title="Start Date"
                month={visibleStartMonth}
                rangeStart={normalizedDraftRange.from}
                rangeEnd={normalizedDraftRange.to}
                onSelect={selectStartDate}
                onPreviousMonth={() =>
                  setVisibleStartMonth((current) => addMonths(current, -1))
                }
                onNextMonth={() =>
                  setVisibleStartMonth((current) => addMonths(current, 1))
                }
              />
              <DatePanel
                title="End Date"
                month={visibleEndMonth}
                rangeStart={normalizedDraftRange.from}
                rangeEnd={normalizedDraftRange.to}
                onSelect={selectEndDate}
                onPreviousMonth={() =>
                  setVisibleEndMonth((current) => addMonths(current, -1))
                }
                onNextMonth={() =>
                  setVisibleEndMonth((current) => addMonths(current, 1))
                }
              />
            </div>
          ) : null}

          <div className="dashboard-filter-footer mt-3">
            <button
              type="button"
              onClick={saveDefaultRange}
              className="dashboard-filter-action mr-auto text-[#184e8a] hover:bg-[#edf4ff]"
            >
              Set default
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="dashboard-filter-action"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyRange}
              className="dashboard-filter-action"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DatePanel({
  title,
  month,
  rangeStart,
  rangeEnd,
  onSelect,
  onPreviousMonth,
  onNextMonth,
}: {
  title: string;
  month: Date;
  rangeStart: string;
  rangeEnd: string;
  onSelect: (value: string) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}) {
  const days = getCalendarDays(month);

  return (
    <section>
      <div className="mb-1.5 text-center text-[0.68rem] font-bold text-[#24272d]">
        {title}
      </div>
      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          onClick={onPreviousMonth}
          className="flex h-6 w-6 items-center justify-center rounded-full text-[#24272d] transition hover:bg-[#f3f6fa]"
          aria-label={`Previous month for ${title}`}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="text-xs font-bold text-[#24272d]">
          {formatMonthHeading(month)}
        </div>
        <button
          type="button"
          onClick={onNextMonth}
          className="flex h-6 w-6 items-center justify-center rounded-full text-[#24272d] transition hover:bg-[#f3f6fa]"
          aria-label={`Next month for ${title}`}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center text-[0.6rem] font-bold uppercase text-[#6b778c]">
        {WEEKDAY_LABELS.map((weekday) => (
          <div key={weekday} className="flex h-5 items-center justify-center">
            {weekday}
          </div>
        ))}
      </div>

      <div className="mt-0.5 grid grid-cols-7 gap-0.5 text-center text-xs text-[#24272d]">
        {days.map((day) => {
          const isSelected =
            day.dateKey === rangeStart || day.dateKey === rangeEnd;
          const isInRange =
            rangeStart &&
            rangeEnd &&
            day.dateKey.localeCompare(rangeStart) > 0 &&
            day.dateKey.localeCompare(rangeEnd) < 0;

          return (
            <button
              type="button"
              key={day.dateKey}
              onClick={() => onSelect(day.dateKey)}
              className={getDateClassName({
                inMonth: day.inMonth,
                isInRange: Boolean(isInRange),
                isSelected,
                isToday: day.isToday,
              })}
              aria-pressed={isSelected}
            >
              {day.dayOfMonth}
            </button>
          );
        })}
      </div>
    </section>
  );
}

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const DATE_PRESETS: { key: TaskDatePresetKey; label: string }[] = [
  { key: "fixed", label: "Fixed" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisMonth", label: "This month" },
  { key: "last7", label: "Last 7 days" },
  { key: "last14", label: "Last 14 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "all", label: "All dates" },
];

function getDateClassName({
  inMonth,
  isInRange,
  isSelected,
  isToday,
}: {
  inMonth: boolean;
  isInRange: boolean;
  isSelected: boolean;
  isToday: boolean;
}) {
  return [
    "flex h-7 items-center justify-center rounded-md font-semibold transition",
    inMonth ? "text-[#24272d]" : "text-[#a5adba]",
    isToday && !isSelected ? "ring-1 ring-[#155fd1]/35" : "",
    isSelected
      ? "bg-[#155fd1] text-white hover:bg-[#0c4fb3]"
      : isInRange
        ? "bg-[#edf4ff] text-[#155fd1] hover:bg-[#deebff]"
        : "hover:bg-[#f3f6fa]",
  ].join(" ");
}

function getCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const calendarStart = new Date(firstDay);
  calendarStart.setDate(firstDay.getDate() - firstDay.getDay());
  const currentMonth = month.getMonth();
  const todayKey = todayDateKey();

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    const dateKey = dateToDateKey(date);

    return {
      dateKey,
      dayOfMonth: date.getDate(),
      inMonth: date.getMonth() === currentMonth,
      isToday: dateKey === todayKey,
    };
  });
}

function normalizeDateRange(from: string, to: string) {
  if (from && to && from.localeCompare(to) > 0) {
    return { from: to, to: from };
  }

  return { from, to };
}

function finalizeDateRange(from: string, to: string) {
  if (!from && !to) return { from: "", to: "" };
  if (from && !to) return { from, to: from };
  if (!from && to) return { from: to, to };

  return normalizeDateRange(from, to);
}

function getDatePresetForRange(from: string, to: string): TaskDatePresetKey {
  if (!from && !to) return "all";

  for (const preset of DATE_PRESETS) {
    if (preset.key === "fixed") continue;

    const presetRange = getPresetDateRange(preset.key);
    if (presetRange.from === from && presetRange.to === to) {
      return preset.key;
    }
  }

  return "fixed";
}

function getPresetDateRange(presetKey: TaskDatePresetKey) {
  const today = new Date();
  const todayKey = dateToDateKey(today);

  switch (presetKey) {
    case "today":
      return { from: todayKey, to: todayKey };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      const yesterdayKey = dateToDateKey(yesterday);
      return { from: yesterdayKey, to: yesterdayKey };
    }
    case "thisMonth": {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: dateToDateKey(firstDay), to: todayKey };
    }
    case "last7":
      return { from: dateToDateKey(addDays(today, -6)), to: todayKey };
    case "last14":
      return { from: dateToDateKey(addDays(today, -13)), to: todayKey };
    case "last30":
      return { from: dateToDateKey(addDays(today, -29)), to: todayKey };
    case "all":
    case "fixed":
      return { from: "", to: "" };
  }
}

function formatDateRangeLabel(from: string, to: string) {
  if (!from && !to) return "All task dates";
  if (from && to) return formatCompactDateRangeLabel(from, to);
  if (from) return `From ${formatDateLabel(from)}`;
  return `Through ${formatDateLabel(to)}`;
}

function formatCompactDateRangeLabel(from: string, to: string) {
  if (from === to) return formatDateLabel(from);

  const start = dateKeyToLocalDate(from);
  const end = dateKeyToLocalDate(to);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${formatMonthDay(from)} - ${end.getDate()}, ${end.getFullYear()}`;
  }

  if (sameYear) {
    return `${formatMonthDay(from)} - ${formatMonthDay(to)}, ${end.getFullYear()}`;
  }

  return `${formatDateLabel(from)} - ${formatDateLabel(to)}`;
}

function formatDateLabel(value: string) {
  if (!value) return "";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(dateKeyToLocalDate(value));
}

function formatMonthDay(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(dateKeyToLocalDate(value));
}

function formatMonthHeading(month: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(month);
}

function todayDateKey() {
  return dateToDateKey(new Date());
}

function dateKeyToMonth(value: string) {
  const date = value ? dateKeyToLocalDate(value) : new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getVisibleDateMonths(from: string, to: string) {
  const startMonth = dateKeyToMonth(from || to || todayDateKey());
  const endMonth = to ? dateKeyToMonth(to) : addMonths(startMonth, 1);

  return { startMonth, endMonth };
}

function dateKeyToLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addDays(date: Date, amount: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function dateToDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

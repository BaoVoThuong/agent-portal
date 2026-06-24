"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  KANBAN_STATUSES,
  STATUS_LABEL,
  TASK_PRIORITIES,
  type TaskCategory,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/types";
import { ALL_AGENTS, NO_AGENT, type QuickFilter } from "@/lib/tasks/filtering";
import { PRIORITY_META, Initials } from "./board-ui";
import { TaskSelect } from "./TaskSelect";

export type BoardView = "board" | "list" | "backlog";

export type AgentStat = {
  key: string;
  label: string;
  total: number;
  active: number;
  waiting: number;
  done: number;
  urgent: number;
};

type QuickFilterOption = {
  key: QuickFilter;
  label: string;
  description: string;
  managerOnly?: boolean;
};

const QUICK_FILTERS: QuickFilterOption[] = [
  { key: "overdue", label: "Overdue", description: "Past due and not done yet" },
  { key: "dueThisWeek", label: "Due this week", description: "Due within the next seven days" },
  { key: "highPriority", label: "High priority", description: "High and urgent work" },
  { key: "recentlyUpdated", label: "Recently updated", description: "Changed in the last three days" },
  { key: "mine", label: "My tasks", description: "Assigned to or reported by me", managerOnly: true },
  { key: "triage", label: "Needs triage", description: "Missing a category or an agent", managerOnly: true },
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
  quickValue,
  onQuickChange,
  priority,
  onPriority,
  category,
  onCategory,
  status,
  onStatus,
  showStatusFacet,
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
  agentFilter: string;
  onAgentFilter: (agent: string) => void;
  quickValue: QuickFilter[];
  onQuickChange: (value: QuickFilter[]) => void;
  priority: "" | TaskPriority;
  onPriority: (value: "" | TaskPriority) => void;
  category: "" | string;
  onCategory: (value: "" | string) => void;
  status: "" | TaskStatus;
  onStatus: (value: "" | TaskStatus) => void;
  showStatusFacet: boolean;
  categories: TaskCategory[];
  resultCount: number;
  totalCount: number;
  onClearAll: () => void;
}) {
  const priorityOptions = [
    { value: "", label: "All priorities" },
    ...TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label })),
  ];
  const categoryOptions = [
    { value: "", label: "All categories" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];
  const statusOptions = [
    { value: "", label: "All statuses" },
    ...KANBAN_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
  ];

  const hasActiveFilters =
    query.trim() !== "" ||
    agentFilter !== ALL_AGENTS ||
    quickValue.length > 0 ||
    priority !== "" ||
    category !== "" ||
    status !== "";

  const views: { key: BoardView; label: string }[] = [
    { key: "board", label: "Board" },
    { key: "list", label: "List" },
    ...(isManager ? [{ key: "backlog" as const, label: "Backlog" }] : []),
  ];

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
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

      <label className="relative block h-10 w-[13.5rem]">
        <span className="sr-only">Search tasks</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search"
          className="h-full w-full rounded border-2 border-transparent bg-[#f4f5f7] pl-10 pr-3 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#44546f] hover:bg-[#ebecf0] focus:border-[#0c66e4] focus:bg-white"
        />
      </label>

      <AgentFilterBar
        stats={agentStats}
        selectedAgent={agentFilter}
        onSelect={onAgentFilter}
      />

      <TaskSelect
        value={priority}
        options={priorityOptions}
        placeholder="All priorities"
        className="w-40"
        buttonClassName="h-9 border-[#dfe1e6] shadow-none"
        onChange={(v) => onPriority(v as "" | TaskPriority)}
      />

      <TaskSelect
        value={category}
        options={categoryOptions}
        placeholder="All categories"
        className="w-40"
        buttonClassName="h-9 border-[#dfe1e6] shadow-none"
        onChange={(v) => onCategory(v)}
      />

      {showStatusFacet ? (
        <TaskSelect
          value={status}
          options={statusOptions}
          placeholder="All statuses"
          className="w-40"
          buttonClassName="h-9 border-[#dfe1e6] shadow-none"
          onChange={(v) => onStatus(v as "" | TaskStatus)}
        />
      ) : null}

      <QuickFilterMenu
        options={QUICK_FILTERS.filter((o) => !o.managerOnly || isManager)}
        value={quickValue}
        onChange={onQuickChange}
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
  );
}

const AGENT_AVATAR_LIMIT = 8;

function agentTooltip(stat: AgentStat) {
  return `${stat.label} — ${stat.active} open · ${stat.waiting} waiting · ${stat.done} done`;
}

function AgentFilterBar({
  stats,
  selectedAgent,
  onSelect,
}: {
  stats: AgentStat[];
  selectedAgent: string;
  onSelect: (agent: string) => void;
}) {
  if (stats.length === 0) return null;

  const visible = stats.slice(0, AGENT_AVATAR_LIMIT);
  const overflow = stats.slice(AGENT_AVATAR_LIMIT);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-sm font-medium text-[#44546f]">Agents</span>
      <div className="flex items-center">
        {visible.map((stat, index) => (
          <AgentAvatar
            key={stat.key}
            stat={stat}
            index={index}
            active={selectedAgent === stat.key}
            onClick={() =>
              onSelect(selectedAgent === stat.key ? ALL_AGENTS : stat.key)
            }
          />
        ))}
        {overflow.length > 0 ? (
          <AgentOverflowMenu
            stats={overflow}
            selectedAgent={selectedAgent}
            onSelect={onSelect}
          />
        ) : null}
      </div>
    </div>
  );
}

function AgentAvatarFace({ stat }: { stat: AgentStat }) {
  if (stat.key === NO_AGENT) {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#dfe1e6] text-[10px] font-bold text-[#44546f] ring-2 ring-white">
        ?
      </span>
    );
  }

  return <Initials email={stat.key} />;
}

function AgentAvatar({
  stat,
  index,
  active,
  onClick,
}: {
  stat: AgentStat;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={agentTooltip(stat)}
      aria-pressed={active}
      aria-label={stat.label}
      style={{ marginLeft: index === 0 ? 0 : "-0.375rem" }}
      className={`relative rounded-full transition hover:z-10 hover:-translate-y-0.5 ${
        active ? "z-20 ring-2 ring-[#0c66e4] ring-offset-1" : ""
      }`}
    >
      <AgentAvatarFace stat={stat} />
    </button>
  );
}

function AgentOverflowMenu({
  stats,
  selectedAgent,
  onSelect,
}: {
  stats: AgentStat[];
  selectedAgent: string;
  onSelect: (agent: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedInOverflow = stats.some((stat) => stat.key === selectedAgent);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      setIsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative" style={{ marginLeft: "-0.375rem" }}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        title="More agents"
        aria-expanded={isOpen}
        className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-white transition hover:z-10 ${
          selectedInOverflow
            ? "z-20 bg-[#0c66e4] text-white"
            : "bg-[#dfe1e6] text-[#44546f] hover:bg-[#c1c7d0]"
        }`}
      >
        +{stats.length}
      </button>

      {isOpen ? (
        <div className="absolute left-0 z-50 mt-2 max-h-64 w-60 overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]">
          {stats.map((stat) => {
            const selected = stat.key === selectedAgent;
            return (
              <button
                key={stat.key}
                type="button"
                onClick={() => {
                  onSelect(stat.key);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
                  selected
                    ? "bg-[#e9f2ff] text-[#0c66e4]"
                    : "text-[#172b4d] hover:bg-[#f4f5f7]"
                }`}
              >
                <AgentAvatarFace stat={stat} />
                <span className="min-w-0 flex-1 truncate font-medium">{stat.label}</span>
                <span className="shrink-0 text-xs font-semibold text-[#626f86]">
                  {stat.active}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function QuickFilterMenu({
  options,
  value,
  onChange,
}: {
  options: QuickFilterOption[];
  value: QuickFilter[];
  onChange: (value: QuickFilter[]) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const activeCount = value.length;

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      setIsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function toggleFilter(filter: QuickFilter) {
    onChange(
      value.includes(filter)
        ? value.filter((item) => item !== filter)
        : [...value, filter]
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-9 items-center gap-2 rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#42526e] transition hover:border-[#c1c7d0]"
        aria-expanded={isOpen}
      >
        Quick Filters
        {activeCount > 0 ? (
          <span className="rounded-full bg-[#deebff] px-2 py-0.5 text-xs text-[#0c66e4]">
            {activeCount}
          </span>
        ) : null}
        <ChevronDown className={`h-4 w-4 transition ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen ? (
        <div className="absolute left-0 z-40 mt-2 w-72 rounded border border-[#dfe1e6] bg-white p-2 shadow-[0_8px_24px_rgba(9,30,66,0.18)]">
          {options.map((filter) => {
            const checked = value.includes(filter.key);
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => toggleFilter(filter.key)}
                className="flex w-full items-start gap-3 rounded px-2 py-2 text-left transition hover:bg-[#f4f5f7]"
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${
                    checked ? "border-[#0c66e4] bg-[#0c66e4]" : "border-[#8590a2] bg-white"
                  }`}
                >
                  {checked ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[#172b4d]">
                    {filter.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[#626f86]">
                    {filter.description}
                  </span>
                </span>
              </button>
            );
          })}

          {activeCount > 0 ? (
            <div className="mt-1 border-t border-[#ebecf0] pt-2">
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded px-2 py-1 text-sm font-semibold text-[#0c66e4] transition hover:bg-[#f4f5f7]"
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

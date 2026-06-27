"use client";

import { Search } from "lucide-react";
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
  agentFilter: string;
  onAgentFilter: (agent: string) => void;
  assignees: TaskAssignee[];
  assigneeFilter: string;
  onAssigneeFilter: (assignee: string) => void;
  presets: QuickFilter[];
  onPresets: (value: QuickFilter[]) => void;
  category: "" | string;
  onCategory: (value: "" | string) => void;
  status: "" | TaskStatus;
  onStatus: (value: "" | TaskStatus) => void;
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
    (showAgent && agentFilter !== ALL_AGENTS) ||
    (showAssignee && assigneeFilter !== "") ||
    presets.length > 0 ||
    category !== "" ||
    (showStatus && status !== "");

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

        <label className="relative block h-10 w-40">
          <span className="sr-only">Search tasks</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search"
            className="h-full w-full rounded border-2 border-transparent bg-[#f4f5f7] pl-10 pr-3 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#44546f] hover:bg-[#ebecf0] focus:border-[#0c66e4] focus:bg-white"
          />
        </label>

        {showAgent ? (
          <TaskSelect
            value={agentFilter}
            options={agentOptions}
            placeholder="Agent"
            className="w-32"
            buttonClassName="h-9 border-[#dfe1e6] shadow-none"
            onChange={(v) => onAgentFilter(v)}
          />
        ) : null}

        {showAssignee ? (
          <TaskSelect
            value={assigneeFilter}
            options={assigneeOptions}
            placeholder="Assignee"
            className="w-32"
            buttonClassName="h-9 border-[#dfe1e6] shadow-none"
            onChange={(v) => onAssigneeFilter(v)}
          />
        ) : null}

        {showStatus ? (
          <TaskSelect
            value={status}
            options={statusOptions}
            placeholder="Status"
            className="w-32"
            buttonClassName="h-9 border-[#dfe1e6] shadow-none"
            onChange={(v) => onStatus(v as "" | TaskStatus)}
          />
        ) : null}

        <TaskSelect
          value={category}
          options={categoryOptions}
          placeholder="Category"
          className="w-32"
          buttonClassName="h-9 border-[#dfe1e6] shadow-none"
          onChange={(v) => onCategory(v)}
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

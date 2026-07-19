"use client";

import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { formatEmailAsName } from "@/lib/tasks/people";
import { rankRecommendation } from "@/lib/tasks/overview";
import type {
  CsOverviewRow,
  OverviewRiskFlag,
  OverviewSnapshot,
  OverviewStatus,
  OverviewThresholds,
  RecommendationCandidate,
  UnassignedOverviewTask,
} from "@/lib/tasks/overview-types";

type SortKey =
  | "status"
  | "name"
  | "openCount"
  | "oldestOpenAgeSeconds"
  | "done24h"
  | "slaLoadMinutes";

const STATUS_LABEL: Record<OverviewStatus, string> = {
  free: "Free",
  ok: "OK",
  busy: "Busy",
  overloaded: "Overloaded",
};

const STATUS_TEXT_CLASS: Record<OverviewStatus, string> = {
  free: "text-emerald-700",
  ok: "text-sky-700",
  busy: "text-amber-700",
  overloaded: "text-rose-700",
};

const RISK_LABEL: Record<OverviewRiskFlag, string> = {
  overdue: "Overdue",
  todo_stuck: "Todo stuck",
  waiting_stuck: "Waiting stuck",
  unknown_effort: "Unknown effort",
};

const RISK_COLOR: Record<OverviewRiskFlag, string> = {
  overdue: "#dc2626",
  todo_stuck: "#ea580c",
  waiting_stuck: "#d97706",
  unknown_effort: "#7c3aed",
};

const STATUS_RANK: Record<OverviewStatus, number> = {
  free: 0,
  ok: 1,
  busy: 2,
  overloaded: 3,
};

const WORK_MIX_STAGES = [
  { key: "todo_overdue", label: "Todo overdue", color: "#dc2626", urgent: true },
  { key: "todo", label: "Todo", color: "#64748b", urgent: false },
  { key: "in_progress_overdue", label: "In progress overdue", color: "#b42318", urgent: true },
  { key: "in_progress", label: "In progress", color: "#0c66e4", urgent: false },
  { key: "waiting", label: "Waiting", color: "#d97706", urgent: false },
] as const;

const WORK_MIX_PRIORITIES = [
  { key: "urgent", label: "Urgent", shortLabel: "Urg", color: "#dc2626" },
  { key: "high", label: "High", shortLabel: "High", color: "#ea580c" },
  { key: "medium", label: "Medium", shortLabel: "Med", color: "#ca8a04" },
  { key: "low", label: "Low", shortLabel: "Low", color: "#64748b" },
] as const;

const BOARD_STAGE_COLORS = {
  todo: "#4c9aff",
  inProgress: "#6554c0",
  waiting: "#ffab00",
  overdue: "#dc2626",
} as const;

function personName(email: string, name: string | null): string {
  return name?.trim() || formatEmailAsName(email);
}

function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded}m`;
  if (rounded < 24 * 60) {
    const hours = Math.floor(rounded / 60);
    const remaining = rounded % 60;
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
  }
  const days = Math.floor(rounded / (24 * 60));
  const remainingHours = Math.floor((rounded % (24 * 60)) / 60);
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return "-";
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function priorityColor(priority: string): string {
  if (priority === "urgent") return "#dc2626";
  if (priority === "high") return "#ea580c";
  if (priority === "medium") return "#ca8a04";
  return "#64748b";
}

function colorWithAlpha(hex: string, alpha: number): string {
  const value = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0");
  return `${hex}${value}`;
}

function StatusBadge({ status }: { status: OverviewStatus }) {
  return (
    <span className={`inline-flex w-full items-center justify-center text-sm font-bold leading-none ${STATUS_TEXT_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function MetricTile({ label, value, detail, tone = "default" }: {
  label: string;
  value: number;
  detail: string;
  tone?: "default" | "warning" | "danger" | "accent";
}) {
  const valueClass = {
    default: "text-[#172b4d]",
    warning: "text-amber-700",
    danger: "text-rose-700",
    accent: "text-[#0c66e4]",
  }[tone];
  return (
    <div className="min-w-0 border-r border-[#e6eaf0] px-4 py-3 first:pl-0 last:border-r-0 last:pr-0 sm:px-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#667085]">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-none ${valueClass}`}>{value}</div>
      <div className="mt-1 text-xs text-[#667085]">{detail}</div>
    </div>
  );
}

function WorkMix({ snapshot }: { snapshot: OverviewSnapshot }) {
  const rowTotal = (stage: (typeof WORK_MIX_STAGES)[number]["key"]) =>
    WORK_MIX_PRIORITIES.reduce(
      (sum, priority) => sum + snapshot.workMix.stagePriority[stage][priority.key],
      0
    );
  const total = WORK_MIX_STAGES.reduce((sum, stage) => sum + rowTotal(stage.key), 0);
  const maxCell = Math.max(
    1,
    ...WORK_MIX_STAGES.flatMap((stage) =>
      WORK_MIX_PRIORITIES.map((priority) => snapshot.workMix.stagePriority[stage.key][priority.key])
    )
  );

  return (
    <div className="min-w-0">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left" aria-label="Open tasks by stage and priority">
        <colgroup>
          <col className="w-[35%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
        </colgroup>
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#667085]">
            <th className="border-b border-[#e6eaf0] pb-2 pr-2">Stage</th>
            {WORK_MIX_PRIORITIES.map((priority) => (
              <th key={priority.key} className="border-b border-[#e6eaf0] px-1 pb-2 text-center" title={priority.label}>
                <span className="inline-flex max-w-full items-center justify-center gap-1 whitespace-nowrap">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: priority.color }} />
                  <span className="truncate">{priority.shortLabel}</span>
                </span>
              </th>
            ))}
            <th className="border-b border-[#e6eaf0] pb-2 pl-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {WORK_MIX_STAGES.map((stage) => {
            const stageTotal = rowTotal(stage.key);
            return (
              <tr key={stage.key}>
                <th className="border-b border-[#f0f2f5] py-2 pr-2">
                  <span className={`flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-bold ${stage.urgent ? "text-rose-700" : "text-[#344054]"}`}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                    <span className="truncate" title={stage.label}>{stage.label}</span>
                  </span>
                </th>
                {WORK_MIX_PRIORITIES.map((priority) => {
                  const value = snapshot.workMix.stagePriority[stage.key][priority.key];
                  const strength = value / maxCell;
                  return (
                    <td key={priority.key} className="border-b border-[#f0f2f5] px-1 py-1.5 text-center">
                      <div
                        className={`flex h-8 items-center justify-center rounded text-xs font-bold ${stage.urgent && value > 0 ? "ring-1 ring-rose-200" : ""}`}
                        style={{
                          backgroundColor: value > 0
                            ? colorWithAlpha(stage.urgent ? stage.color : priority.color, 0.1 + strength * 0.24)
                            : "#f8fafc",
                          color: value > 0 ? (stage.urgent ? stage.color : priority.color) : "#98a2b3",
                        }}
                        title={`${stage.label} ${priority.label}: ${value} task${value === 1 ? "" : "s"}`}
                      >
                        {value}
                      </div>
                    </td>
                  );
                })}
                <td className="border-b border-[#f0f2f5] py-2 pl-1 text-right text-xs font-bold text-[#172b4d]">{stageTotal}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th className="pt-2 pr-2 text-xs font-bold text-[#475467]">Total</th>
            {WORK_MIX_PRIORITIES.map((priority) => (
              <td key={priority.key} className="px-1 pt-2 text-center text-xs font-bold" style={{ color: priority.color }}>
                {snapshot.workMix.priorities[priority.key]}
              </td>
            ))}
            <td className="pt-2 pl-1 text-right text-xs font-bold text-[#172b4d]">{total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function AttentionChart({
  snapshot,
  activeRisk,
  onRisk,
}: {
  snapshot: OverviewSnapshot;
  activeRisk: OverviewRiskFlag | null;
  onRisk: (risk: OverviewRiskFlag | null) => void;
}) {
  const max = Math.max(1, ...snapshot.attention.map((item) => item.taskCount));
  return (
    <div className="min-w-0 space-y-2">
        {snapshot.attention.map((item) => {
          const active = activeRisk === item.key;
          return (
            <button
              type="button"
              key={item.key}
              onClick={() => onRisk(active ? null : item.key)}
              className={`grid w-full grid-cols-[minmax(7.5rem,9.5rem)_minmax(6rem,1fr)_max-content] items-center gap-2 rounded px-2 py-2 text-left transition hover:bg-[#f8fafc] ${active ? "bg-[#eff6ff]" : ""}`}
              aria-pressed={active}
            >
              <span className="truncate whitespace-nowrap text-xs font-semibold text-[#475467]">{item.label}</span>
              <span className="h-5 overflow-hidden rounded bg-[#f2f4f7]">
                <span className="block h-full rounded" style={{ width: `${(item.taskCount / max) * 100}%`, backgroundColor: RISK_COLOR[item.key] }} />
              </span>
              <span className="whitespace-nowrap text-right text-xs text-[#667085]">{item.taskCount} tasks / {item.affectedCsCount} CS</span>
            </button>
          );
        })}
    </div>
  );
}

type SlaBand = "none" | "within" | "high" | "very_high" | "overdue" | "unknown";

const SLA_BAND_LABEL: Record<SlaBand, string> = {
  none: "No open work",
  within: "Within range",
  high: "High exposure",
  very_high: "Very high",
  overdue: "Overdue",
  unknown: "Unknown",
};

const SLA_BAND_COLOR: Record<SlaBand, string> = {
  none: "#98a2b3",
  within: "#0c66e4",
  high: "#d97706",
  very_high: "#dc2626",
  overdue: "#b42318",
  unknown: "#7c3aed",
};

function slaBand(row: CsOverviewRow, thresholds: OverviewThresholds): SlaBand {
  if (row.openCount === 0) return "none";
  if (row.riskFlags.includes("overdue")) return "overdue";
  if (row.riskFlags.includes("unknown_effort")) return "unknown";
  if (row.slaLoadMinutes >= thresholds.slaOverloadedMinutes) return "very_high";
  if (row.slaLoadMinutes >= thresholds.slaBusyMinutes) return "high";
  return "within";
}

function SortIcon({ active, ascending }: { active: boolean; ascending: boolean }) {
  if (!active) return null;
  return ascending ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

function WorkloadSummary({ row }: { row: CsOverviewRow }) {
  const todoOverdue = row.tasks.filter((task) => task.status === "todo" && task.riskFlags.includes("todo_stuck")).length;
  const doingOverdue = row.tasks.filter((task) => task.status === "in_progress" && task.riskFlags.includes("overdue")).length;
  const overdueCount = todoOverdue + doingOverdue;
  const counts = [
    {
      label: "to do",
      value: Math.max(0, row.stageCounts.todo - todoOverdue),
      color: BOARD_STAGE_COLORS.todo,
      title: "To do tasks that are not overdue",
    },
    {
      label: "in progress",
      value: Math.max(0, row.stageCounts.in_progress - doingOverdue),
      color: BOARD_STAGE_COLORS.inProgress,
      title: "In progress tasks that are not overdue",
    },
    {
      label: "waiting",
      value: row.stageCounts.waiting,
      color: BOARD_STAGE_COLORS.waiting,
      title: "Waiting tasks",
    },
    {
      label: "overdue",
      value: overdueCount,
      color: BOARD_STAGE_COLORS.overdue,
      title: `${todoOverdue} overdue to do, ${doingOverdue} overdue in progress`,
    },
  ];

  return (
    <div className="min-w-0" aria-label={`${row.openCount} open tasks by stage`}>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="whitespace-nowrap">
          <span className="text-lg font-bold leading-none text-[#172b4d]">{row.openCount}</span>
          <span className="ml-1 text-xs font-bold uppercase tracking-[0.04em] text-[#98a2b3]">open</span>
        </span>
      </div>
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] font-semibold text-[#667085]">
        {counts.map((item, index) => (
          <Fragment key={item.label}>
            <span className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap" title={item.title}>
              <span className="text-sm font-bold leading-none" style={{ color: item.color }}>{item.value}</span>
              <span>{item.label}</span>
            </span>
            {index < counts.length - 1 ? <span className="shrink-0 text-[#cbd5e1]">/</span> : null}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function SlaSummary({
  row,
  thresholds,
  maxLoad,
}: {
  row: CsOverviewRow;
  thresholds: OverviewThresholds;
  maxLoad: number;
}) {
  const band = slaBand(row, thresholds);
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="whitespace-nowrap text-xs font-bold" style={{ color: SLA_BAND_COLOR[band] }}>{SLA_BAND_LABEL[band]}</span>
        <span className="text-sm font-bold text-[#172b4d]">{formatMinutes(row.slaLoadMinutes)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[#e9eef5]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, (row.slaLoadMinutes / maxLoad) * 100)}%`,
            backgroundColor: SLA_BAND_COLOR[band],
          }}
        />
      </div>
      <div className="mt-1 text-[10px] font-semibold text-[#98a2b3]">
        8h / 16h thresholds
      </div>
    </div>
  );
}

function CsTable({
  rows,
  thresholds,
  selectedEmail,
  onSelect,
  onOpenTask,
}: {
  rows: CsOverviewRow[];
  thresholds: OverviewThresholds;
  selectedEmail: string | null;
  onSelect: (email: string | null) => void;
  onOpenTask: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [ascending, setAscending] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const maxLoad = Math.max(1, ...rows.map((row) => row.slaLoadMinutes));
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    let result = 0;
    if (sortKey === "name") result = personName(a.email, a.name).localeCompare(personName(b.email, b.name));
    else if (sortKey === "status") result = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    else result = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
    return (ascending ? 1 : -1) * (result || a.email.localeCompare(b.email));
  }), [ascending, rows, sortKey]);

  function changeSort(next: SortKey) {
    if (sortKey === next) setAscending((value) => !value);
    else {
      setSortKey(next);
      setAscending(true);
    }
  }

  const headers: Array<{ key: SortKey; label: string; align?: "left" | "center" }> = [
    { key: "name", label: "CS" },
    { key: "status", label: "Status", align: "center" },
    { key: "oldestOpenAgeSeconds", label: "Oldest date", align: "center" },
    { key: "done24h", label: "Done 24h", align: "center" },
    { key: "openCount", label: "Workload by stage" },
    { key: "slaLoadMinutes", label: "SLA" },
  ];

  const headerCellClass = "border-b border-r border-[#dbe2eb] bg-[#f8fafc] px-4 py-3 font-bold last:border-r-0";
  const bodyCellClass = "border-b border-r border-[#e6eaf0] px-4 py-3 last:border-r-0";
  const centerCellClass = `${bodyCellClass} text-center`;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[980px] w-full table-fixed border-collapse border-t border-[#dbe2eb] text-left">
        <colgroup>
          <col className="w-9" />
          <col className="w-[24%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[8%]" />
          <col className="w-[32%]" />
          <col className="w-[18%]" />
        </colgroup>
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.06em] text-[#667085]">
            <th className="border-b border-r border-[#dbe2eb] bg-[#f8fafc] px-2 py-3" />
            {headers.map((header) => (
              <th key={header.key} className={`${headerCellClass} ${header.align === "center" ? "text-center" : ""}`}>
                <button
                  type="button"
                  onClick={() => changeSort(header.key)}
                  className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-[#172b4d] ${header.align === "center" ? "justify-center" : ""}`}
                  aria-label={`Sort by ${header.label}`}
                >
                  {header.label}
                  <SortIcon active={sortKey === header.key} ascending={ascending} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const isExpanded = expanded.has(row.email);
            const selected = selectedEmail === row.email;
            return (
              <Fragment key={row.email}>
                <tr className={`align-middle transition ${selected ? "bg-[#eff6ff]" : "hover:bg-[#fafbfc]"}`}>
                  <td className="border-b border-r border-[#e6eaf0] px-2 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(row.email)) next.delete(row.email); else next.add(row.email);
                        return next;
                      })}
                      className="rounded p-1 text-[#667085] hover:bg-[#eaf2ff] hover:text-[#0c66e4]"
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} tasks for ${personName(row.email, row.name)}`}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className={bodyCellClass}>
                    <button type="button" onClick={() => onSelect(selected ? null : row.email)} className="block max-w-full text-left">
                      <div className="truncate text-sm font-bold text-[#172b4d]">{personName(row.email, row.name)}</div>
                      <div className="mt-0.5 truncate text-[11px] text-[#98a2b3]">{row.email}</div>
                    </button>
                  </td>
                  <td className={centerCellClass}>
                    <StatusBadge status={row.status} />
                  </td>
                  <td
                    className={`${centerCellClass} whitespace-nowrap text-xs font-bold text-[#475467]`}
                    title={row.oldestOpenCreatedAt ? `${formatAge(row.oldestOpenAgeSeconds)} old` : "No open task"}
                  >
                    {row.oldestOpenCreatedAt ? formatShortDate(row.oldestOpenCreatedAt) : "-"}
                  </td>
                  <td className={`${centerCellClass} whitespace-nowrap text-xs font-bold text-[#475467]`}>{row.done24h}</td>
                  <td className={bodyCellClass}><WorkloadSummary row={row} /></td>
                  <td className={bodyCellClass}><SlaSummary row={row} thresholds={thresholds} maxLoad={maxLoad} /></td>
                </tr>
                {isExpanded ? (
                  <tr className="bg-[#fafbfc]">
                    <td colSpan={7} className="border-b border-[#dbe2eb] px-10 py-3">
                      {row.tasks.length === 0 ? <span className="text-xs text-[#667085]">No open tasks.</span> : (
                        <div className="grid gap-2 md:grid-cols-2">
                          {row.tasks.map((task) => (
                            <button key={task.id} type="button" onClick={() => onOpenTask(task.id)} className="flex items-center justify-between gap-3 rounded border border-[#e2e8f0] bg-white px-3 py-2 text-left hover:border-[#93c5fd] hover:bg-[#f8fbff]">
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-semibold text-[#172b4d]">{task.title}</span>
                                <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#667085]">
                                  <span className="capitalize">{task.status.replace("_", " ")}</span>
                                  <span style={{ color: priorityColor(task.priority) }} className="font-bold">{task.priority}</span>
                                  <span>{formatMinutes(task.slaLoadMinutes)} SLA exposure</span>
                                </span>
                              </span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#98a2b3]" />
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationPanel({
  task,
  rows,
  onAssign,
  assigningEmail,
}: {
  task: UnassignedOverviewTask;
  rows: CsOverviewRow[];
  onAssign: (email: string) => void;
  assigningEmail: string | null;
}) {
  const candidates = useMemo(() => rankRecommendation(task, rows), [rows, task]);
  const top = candidates.slice(0, 5);
  return (
    <div className="border-t border-[#e6eaf0] bg-[#fbfdff] px-4 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#0c66e4]">Assignment support</div>
          <h3 className="mt-1 text-sm font-bold text-[#172b4d]">Who has room for &quot;{task.title}&quot;?</h3>
          <p className="mt-1 text-xs text-[#667085]">Ranked from the workload dashboard metrics after adding this task as Todo.</p>
        </div>
        <span className="rounded bg-[#eef6ff] px-2 py-1 text-xs font-bold capitalize text-[#0c66e4]">{task.priority}</span>
      </div>
      {top.length === 0 ? <div className="text-sm text-[#667085]">No eligible CS in the current pool.</div> : (
        <div className="grid gap-2 lg:grid-cols-2">
          {top.map((candidate, index) => (
            <CandidateRow key={candidate.email} candidate={candidate} index={index} onAssign={() => onAssign(candidate.email)} assigning={assigningEmail !== null} />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateRow({ candidate, index, onAssign, assigning }: {
  candidate: RecommendationCandidate;
  index: number;
  onAssign: () => void;
  assigning: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-[#dbe7f5] bg-white px-3 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef6ff] text-xs font-bold text-[#0c66e4]">{index + 1}</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-[#172b4d]">{personName(candidate.email, candidate.name)}</div>
          <div className="mt-1 text-[11px] text-[#667085]">{candidate.openCount} open | {formatMinutes(candidate.slaLoadMinutes)} SLA exposure | {candidate.inProgressCount} in progress</div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-[#475467]"><CircleHelp className="h-3 w-3 text-[#0c66e4]" />{candidate.why}</div>
        </div>
      </div>
      <button type="button" onClick={onAssign} disabled={assigning} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded bg-[#0c66e4] px-3 text-xs font-bold text-white hover:bg-[#0055cc] disabled:cursor-wait disabled:opacity-60">
        {assigning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
        {assigning ? "Assigning" : "Assign"}
      </button>
    </div>
  );
}

function CategoryMeta({ task }: { task: UnassignedOverviewTask }) {
  const label = task.categoryName ?? "No category";
  return (
    <span className="block min-w-0 truncate">
      {label}
    </span>
  );
}

function UnassignedTaskRow({
  task,
  selected,
  selectedTask,
  assigningTaskId,
  rows,
  onSelectTask,
  onAssign,
}: {
  task: UnassignedOverviewTask;
  selected: boolean;
  selectedTask: UnassignedOverviewTask | null;
  assigningTaskId: string | null;
  rows: CsOverviewRow[];
  onSelectTask: (id: string | null) => void;
  onAssign: (taskId: string, email: string, expectedUpdatedAt: string | null) => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelectTask(selected ? null : task.id)}
        className={`grid w-full gap-x-4 gap-y-2 px-4 py-3 text-left transition sm:grid-cols-[minmax(12rem,1fr)_8.5rem_11rem_5.5rem_6.5rem_7rem_5.5rem] sm:items-center sm:px-5 ${selected ? "bg-[#eff6ff]" : "hover:bg-[#fafbfc]"}`}
        aria-pressed={selected}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[#172b4d]">{task.title}</span>
        </span>
        <span className="min-w-0 truncate text-xs font-semibold text-[#667085]">
          {task.agentEmail ? formatEmailAsName(task.agentEmail) : "No agent"}
        </span>
        <span className="min-w-0 text-xs font-semibold text-[#667085]">
          <CategoryMeta task={task} />
        </span>
        <span className="whitespace-nowrap text-xs font-semibold text-[#667085]" title={`${formatAge(task.ageSeconds)} old`}>
          {formatShortDate(task.createdAt)}
        </span>
        <span className="capitalize text-xs font-bold" style={{ color: priorityColor(task.priority) }}>{task.priority}</span>
        <span className="text-xs text-[#475467]">{formatMinutes(task.effectiveSlaMinutes)} SLA</span>
        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#0c66e4] sm:justify-self-end">
          {selected ? "Hide" : "Recommend"}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </button>
      {selected && selectedTask ? (
        <RecommendationPanel
          task={selectedTask}
          rows={rows}
          onAssign={(email) => onAssign(task.id, email, task.updatedAt)}
          assigningEmail={assigningTaskId === task.id ? "pending" : null}
        />
      ) : null}
    </div>
  );
}

export function CSWorkloadOverview({
  snapshot,
  loading,
  refreshing,
  error,
  notice,
  onRefresh,
  onOpenTask,
  onAssign,
  assigningTaskId,
  selectedTaskId,
  onSelectTask,
}: {
  snapshot: OverviewSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  notice: string | null;
  onRefresh: () => void;
  onOpenTask: (id: string) => void;
  onAssign: (taskId: string, email: string, expectedUpdatedAt: string | null) => void;
  assigningTaskId: string | null;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [activeRisk, setActiveRisk] = useState<OverviewRiskFlag | null>(null);
  const [unassignedSort, setUnassignedSort] = useState<"priority" | "age" | "sla">("priority");
  const [showExceptions, setShowExceptions] = useState(false);
  const tableRef = useRef<HTMLElement>(null);

  const focusTable = useCallback(() => {
    window.requestAnimationFrame(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const selectRisk = useCallback((risk: OverviewRiskFlag | null) => {
    setActiveRisk(risk);
    setSelectedEmail(null);
    focusTable();
  }, [focusTable]);

  const filteredRows = useMemo(() => {
    if (!snapshot) return [];
    const query = search.trim().toLowerCase();
    return snapshot.csRows.filter((row) => {
      const matchesSearch = !query || row.email.toLowerCase().includes(query) || personName(row.email, row.name).toLowerCase().includes(query);
      const matchesRisk = !activeRisk || row.riskFlags.includes(activeRisk);
      const matchesPerson = !selectedEmail || row.email === selectedEmail;
      return matchesSearch && matchesRisk && matchesPerson;
    });
  }, [activeRisk, search, selectedEmail, snapshot]);

  const unassigned = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.unassigned].sort((a, b) => {
      if (unassignedSort === "age") return b.ageSeconds - a.ageSeconds;
      if (unassignedSort === "sla") return a.effectiveSlaMinutes - b.effectiveSlaMinutes;
      const rank = { urgent: 4, high: 3, medium: 2, low: 1 } as Record<string, number>;
      return rank[b.priority] - rank[a.priority] || b.ageSeconds - a.ageSeconds;
    });
  }, [snapshot, unassignedSort]);

  const selectedTask = snapshot?.unassigned.find((task) => task.id === selectedTaskId) ?? null;

  if (loading && !snapshot) {
    return <div className="flex min-h-[28rem] items-center justify-center text-sm text-[#667085]"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Loading workload overview...</div>;
  }
  if (!snapshot) {
    return <div className="m-6 border border-rose-200 bg-rose-50 px-4 py-8 text-center text-sm text-rose-700">{error ?? "Could not load workload overview."}<button type="button" onClick={onRefresh} className="ml-3 font-bold underline">Retry</button></div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#f7f9fc] px-4 pb-8 pt-4 sm:px-6">
      <div className="mx-auto max-w-[1480px] min-w-0 space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[#0c66e4]">Admin workload dashboard {refreshing ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}</div>
            <h2 className="mt-1 text-2xl font-bold tracking-normal text-[#172b4d]">CS Workload Overview</h2>
            <p className="mt-1 text-xs text-[#667085]">Snapshot at {new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. SLA exposure is a workload proxy, not an ETA.</p>
          </div>
          <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded border border-[#cfd8e5] bg-white px-3 text-sm font-bold text-[#344054] shadow-sm hover:bg-[#f8fafc] disabled:opacity-60" title="Refresh overview">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        </header>

        {error ? <div className="flex items-center justify-between gap-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><span>Showing the last good snapshot. {error}</span><button type="button" onClick={onRefresh} className="font-bold underline">Retry</button></div> : null}
        {notice ? <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800" role="status">{notice}</div> : null}

        <section className="border border-[#dbe2eb] bg-white px-4 py-1 shadow-[0_1px_2px_rgba(22,35,58,0.04)] sm:px-5" aria-label="Workload totals">
          <div className="grid grid-cols-2 divide-x divide-[#e6eaf0] sm:grid-cols-3 lg:grid-cols-5">
            <MetricTile label="CS pool" value={snapshot.kpis.csPoolCount} detail={`${snapshot.kpis.zeroLoadCsCount} with zero load`} tone="accent" />
            <MetricTile label="Open tasks" value={snapshot.kpis.openTaskCount} detail="todo + in progress + waiting" />
            <MetricTile label="Urgent / high" value={snapshot.kpis.urgentHighTaskCount} detail="open priority load" tone={snapshot.kpis.urgentHighTaskCount ? "warning" : "default"} />
            <MetricTile label="Needs attention" value={snapshot.kpis.needsAttentionTaskCount} detail="risk-flagged open tasks" tone={snapshot.kpis.needsAttentionTaskCount ? "danger" : "default"} />
            <MetricTile label="Unassigned" value={snapshot.kpis.unassignedTaskCount} detail="backlog tasks" tone={snapshot.kpis.unassignedTaskCount ? "accent" : "default"} />
          </div>
        </section>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <section className="min-w-0 border border-[#dbe2eb] bg-white p-4 shadow-[0_1px_2px_rgba(22,35,58,0.04)] sm:p-5">
            <div className="mb-4"><h3 className="text-sm font-bold text-[#172b4d]">Attention areas</h3><p className="mt-1 text-xs text-[#667085]">Select a bar to focus the CS table on the affected people.</p></div>
            <AttentionChart snapshot={snapshot} activeRisk={activeRisk} onRisk={selectRisk} />
          </section>
          <section className="min-w-0 border border-[#dbe2eb] bg-white p-4 shadow-[0_1px_2px_rgba(22,35,58,0.04)] sm:p-5">
            <div className="mb-4"><h3 className="text-sm font-bold text-[#172b4d]">Work mix</h3><p className="mt-1 text-xs text-[#667085]">Open tasks by stage and priority, with overdue Todo/In progress separated.</p></div>
            <WorkMix snapshot={snapshot} />
          </section>
        </div>

        <section ref={tableRef} className="border border-[#dbe2eb] bg-white shadow-[0_1px_2px_rgba(22,35,58,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6eaf0] px-4 py-4 sm:px-5">
            <div><h3 className="text-sm font-bold text-[#172b4d]">CS workload</h3><p className="mt-1 text-xs text-[#667085]">{filteredRows.length} of {snapshot.csRows.length} CS shown. Expand a row to inspect tasks.</p></div>
            <div className="flex w-full items-center gap-2 sm:w-auto"><div className="relative min-w-0 flex-1 sm:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98a2b3]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search CS" className="h-9 w-full rounded border border-[#cfd8e5] bg-white pl-9 pr-3 text-sm text-[#172b4d] outline-none focus:border-[#0c66e4] focus:ring-2 focus:ring-[#dbeafe]" /></div><span className="inline-flex h-9 items-center gap-1 rounded bg-[#f2f4f7] px-2 text-xs text-[#667085]"><SlidersHorizontal className="h-3.5 w-3.5" /> {activeRisk ? RISK_LABEL[activeRisk] : "All"}</span></div>
          </div>
          <CsTable rows={filteredRows} thresholds={snapshot.thresholds} selectedEmail={selectedEmail} onSelect={(email) => { setSelectedEmail(email); setActiveRisk(null); }} onOpenTask={onOpenTask} />
        </section>

        {snapshot.outOfPool.length > 0 ? (
          <section className="border border-violet-200 bg-violet-50 shadow-[0_1px_2px_rgba(22,35,58,0.04)]">
            <button type="button" onClick={() => setShowExceptions((value) => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"><span className="flex items-center gap-2 text-sm font-bold text-violet-900"><AlertTriangle className="h-4 w-4" /> Assignments outside the CS pool ({snapshot.outOfPool.reduce((sum, item) => sum + item.taskCount, 0)} tasks)</span>{showExceptions ? <ChevronDown className="h-4 w-4 text-violet-700" /> : <ChevronRight className="h-4 w-4 text-violet-700" />}</button>
            {showExceptions ? <div className="border-t border-violet-200 px-4 py-3 text-xs text-violet-900 sm:px-5">{snapshot.outOfPool.map((item) => <div key={item.email} className="flex justify-between gap-3 py-1"><span>{formatEmailAsName(item.email)}</span><span>{item.taskCount} open task{item.taskCount === 1 ? "" : "s"}</span></div>)}</div> : null}
          </section>
        ) : null}

        <section className="border border-[#dbe2eb] bg-white shadow-[0_1px_2px_rgba(22,35,58,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6eaf0] px-4 py-4 sm:px-5"><div><h3 className="text-sm font-bold text-[#172b4d]">Unassigned queue</h3><p className="mt-1 text-xs text-[#667085]">Choose a task to add assignment support to the dashboard.</p></div><select value={unassignedSort} onChange={(event) => setUnassignedSort(event.target.value as typeof unassignedSort)} className="h-9 rounded border border-[#cfd8e5] bg-white px-2 text-xs font-bold text-[#475467] outline-none"><option value="priority">Sort: priority</option><option value="age">Sort: oldest</option><option value="sla">Sort: SLA urgency</option></select></div>
          {unassigned.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[#667085]">No unassigned backlog tasks.</div>
          ) : (
            <div>
              <div className="hidden gap-x-4 border-b border-[#eef1f5] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[#667085] sm:grid sm:grid-cols-[minmax(12rem,1fr)_8.5rem_11rem_5.5rem_6.5rem_7rem_5.5rem] sm:px-5">
                <span>Task</span>
                <span>Agent</span>
                <span>Category</span>
                <span>Created</span>
                <span>Priority</span>
                <span>SLA</span>
                <span className="text-right">Action</span>
              </div>
              <div className="divide-y divide-[#eef1f5]">
                {unassigned.map((task) => {
                  const selected = task.id === selectedTaskId;
                  return (
                    <UnassignedTaskRow
                      key={task.id}
                      task={task}
                      selected={selected}
                      selectedTask={selectedTask}
                      assigningTaskId={assigningTaskId}
                      rows={snapshot.csRows}
                      onSelectTask={onSelectTask}
                      onAssign={onAssign}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

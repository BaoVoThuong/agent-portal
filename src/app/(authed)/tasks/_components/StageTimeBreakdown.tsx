"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import type { TaskRow } from "@/lib/tasks/types";
import { formatDurationSeconds, stageElapsedSeconds } from "@/lib/tasks/sla";

// Cumulative time the task has spent in each stage across ALL stints (banked
// accumulator + the current open stint), plus the permanent overdue / reopen
// counters. `now` is computed at render — a detail drawer re-renders often
// enough that second-precision on the open stint isn't needed here.
export function StageTimeBreakdown({ task }: { task: TaskRow }) {
  const now = new Date();
  const rows = [
    {
      label: "To Do",
      seconds: stageElapsedSeconds(task.todo_seconds, task.todo_started_at, now),
    },
    {
      label: "In Progress",
      seconds: stageElapsedSeconds(task.in_progress_seconds, task.in_progress_at, now),
    },
    {
      label: "Waiting",
      seconds: stageElapsedSeconds(task.waiting_seconds, task.waiting_started_at, now),
    },
  ];

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
        Time in stage
      </span>
      <dl className="space-y-1 rounded border border-[#dfe1e6] bg-white px-3 py-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-sm">
            <dt className="text-[#44546f]">{row.label}</dt>
            <dd className="font-semibold text-[#172b4d]">
              {formatDurationSeconds(row.seconds)}
            </dd>
          </div>
        ))}
      </dl>
      {task.overdue_count > 0 || task.reopened_at ? (
        <div className="flex flex-wrap gap-1.5">
          {task.overdue_count > 0 ? (
            <span className="inline-flex items-center gap-1 rounded bg-[#fff7d6] px-1.5 py-0.5 text-[11px] font-bold text-[#7f5f01]">
              <AlertTriangle className="h-3 w-3" />
              Went overdue {task.overdue_count}×
            </span>
          ) : null}
          {task.reopened_at ? (
            <span className="inline-flex items-center gap-1 rounded bg-[#deebff] px-1.5 py-0.5 text-[11px] font-bold text-[#0055cc]">
              <RotateCcw className="h-3 w-3" />
              Reopened
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import type { ActivityRow } from "@/lib/tasks/detail";

function formatDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function formatOverdueBy(dueAt: unknown, resolvedAt: unknown): string | null {
  if (typeof dueAt !== "string" || typeof resolvedAt !== "string") return null;
  const due = new Date(dueAt).getTime();
  const resolved = new Date(resolvedAt).getTime();
  if (Number.isNaN(due) || Number.isNaN(resolved) || resolved < due) return null;
  const totalMinutes = Math.round((resolved - due) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function OverdueLog({
  entries,
  personLabelByEmail,
}: {
  entries: ActivityRow[];
  personLabelByEmail?: Map<string, string>;
}) {
  if (entries.length === 0) {
    return <p className="text-xs text-[#6b778c]">No overdue history yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => {
        const meta = (entry.meta ?? {}) as Record<string, unknown>;
        const reason = typeof meta.reason === "string" ? meta.reason : null;
        const dueLabel = formatDateTime(meta.due_at);
        const resolvedLabel = formatDateTime(meta.resolved_at ?? entry.created_at);
        const overdueBy = formatOverdueBy(meta.due_at, meta.resolved_at);
        const fromStatus = typeof meta.from_status === "string" ? meta.from_status : null;
        const actorLabel =
          personLabelByEmail?.get(entry.actor_email) ?? entry.actor_email;
        const isReopen = entry.type === "task_reopened";

        return (
          <li
            key={entry.id}
            className={`rounded border p-3 ${
              isReopen ? "border-[#dfe1e6] bg-[#f7f8f9]" : "border-[#ffbdad] bg-[#ffebe6]"
            }`}
          >
            <div
              className={`flex items-center gap-1.5 text-xs font-bold ${
                isReopen ? "text-[#42526e]" : "text-[#bf2600]"
              }`}
            >
              {isReopen ? (
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              )}
              {isReopen
                ? `Reopened by ${actorLabel}${fromStatus ? ` (from ${fromStatus})` : ""}`
                : `Overdue resolved by ${actorLabel}`}
            </div>
            <dl className="mt-1.5 space-y-0.5 text-xs leading-5 text-[#6b778c]">
              {dueLabel ? (
                <div>
                  <dt className="inline font-semibold text-[#42526e]">Due at:</dt>{" "}
                  <dd className="inline">{dueLabel}</dd>
                </div>
              ) : null}
              <div>
                <dt className="inline font-semibold text-[#42526e]">
                  {isReopen ? "Reopened at:" : "Resolved at:"}
                </dt>{" "}
                <dd className="inline">{resolvedLabel ?? "—"}</dd>
              </div>
              {overdueBy ? (
                <div>
                  <dt className="inline font-semibold text-[#42526e]">Overdue by:</dt>{" "}
                  <dd className="inline">{overdueBy}</dd>
                </div>
              ) : null}
            </dl>
            {reason ? (
              <p className="mt-1.5 text-xs leading-5 text-[#172b4d]">
                <span className="font-semibold text-[#42526e]">Reason:</span> &quot;{reason}&quot;
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

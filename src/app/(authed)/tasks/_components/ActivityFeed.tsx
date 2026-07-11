"use client";

import { type ReactNode } from "react";
import type { ActivityRow } from "@/lib/tasks/detail";

function describe(a: ActivityRow, personLabel: (email: string) => string): ReactNode {
  const rawTo =
    a.meta && "to" in a.meta ? String((a.meta as { to: unknown }).to ?? "—") : "";
  const to = formatActivityValue(a.type, rawTo, personLabel);

  switch (a.type) {
    case "created": return "created the task";
    case "status_changed": return <>moved to {to}</>;
    case "reopened": return <>reopened ({to})</>;
    case "assigned": return <>assigned to {to}</>;
    case "unassigned": return <>removed {to} from the task</>;
    case "priority_changed": return <>set priority {to}</>;
    case "category_changed": return "changed category";
    case "agent_changed": return <>changed agent to {to}</>;
    case "qc_needed": return "marked a Done task for QC";
    case "due_soon": return "task is due soon";
    case "stale": return "task had no activity";
    case "done_reviewed": return "QC checked the completed task";
    case "done_review_cleared": return "cleared the QC check";
    case "comment_added": return "commented";
    case "edited": return "edited the task";
    case "archived": return "archived the task";
    case "overdue_resolved": return "resolved an overdue task";
    case "overdue_unlocked": return "unlocked an overdue task";
    case "task_reopened": return "reopened this task (with a reason)";
    case "went_overdue": return "task went overdue";
    default: return a.type;
  }
}

export function ActivityFeed({
  activity,
  personLabelByEmail,
}: {
  activity: ActivityRow[];
  personLabelByEmail?: Map<string, string>;
}) {
  const personLabel = (email: string) =>
    personLabelByEmail?.get(email) ?? formatEmailAsName(email);

  if (activity.length === 0)
    return <p className="text-xs text-[#6b778c]">No activity yet.</p>;

  return (
    <ul className="space-y-2">
      {activity.map((a) => (
        <li key={a.id} className="text-xs leading-5 text-[#6b778c]">
          <strong className="font-semibold text-[#172b4d]">
            {personLabel(a.actor_email)}
          </strong>{" "}
          {describe(a, personLabel)}
          <span className="ml-1 whitespace-nowrap text-[#97a0af]">
            {new Date(a.created_at).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatActivityValue(
  type: string,
  value: string,
  personLabel: (email: string) => string
) {
  if (!value || value === "—") return "—";
  if (type === "agent_changed" || type === "assigned" || type === "unassigned") {
    return (
      <strong className="font-semibold text-[#172b4d]">
        {personLabel(value)}
      </strong>
    );
  }
  return value.replaceAll("_", " ");
}

function formatEmailAsName(email: string) {
  const localPart = email.split("@")[0] ?? email;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

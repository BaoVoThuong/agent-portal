"use client";

import { type ReactNode } from "react";
import type { ActivityRow } from "@/lib/tasks/detail";
import { describeActivity } from "@/lib/tasks/activity-events";
import { ACTIVITY_LABELS } from "./activity-labels";
import { UNKNOWN_PERSON_LABEL } from "@/lib/people/display-names";

function describe(a: ActivityRow, personLabel: (email: string) => string): ReactNode {
  const assignment = describeActivity(a);
  const rawTo = assignment
    ? assignment.subject ?? "—"
    : a.meta && "to" in a.meta
      ? String((a.meta as { to: unknown }).to ?? "—")
      : "";
  const to = formatActivityValue(a.type, rawTo, personLabel);

  switch (a.type) {
    case "created": return ACTIVITY_LABELS.created;
    case "status_changed": return <>moved to {to}</>;
    case "reopened": return <>reopened ({to})</>;
    case "assigned":
      return assignment?.kind === "unassigned"
        ? <>removed {to} from the task</>
        : <>assigned to {to}</>;
    case "unassigned": return <>removed {to} from the task</>;
    case "priority_changed": return <>set priority {to}</>;
    case "agent_changed": return <>changed agent to {to}</>;
    default:
      return a.type in ACTIVITY_LABELS
        ? ACTIVITY_LABELS[a.type as keyof typeof ACTIVITY_LABELS]
        : a.type;
  }
}

export function ActivityFeed({
  activity,
  personLabelByEmail,
}: {
  activity: ActivityRow[];
  personLabelByEmail?: Map<string, string>;
}) {
  const personLabel = (email: string, canonicalName?: string | null) =>
    canonicalName?.trim() || personLabelByEmail?.get(email) || UNKNOWN_PERSON_LABEL;

  if (activity.length === 0)
    return <p className="text-xs text-[#6b778c]">No activity yet.</p>;

  return (
    <ul className="space-y-2">
      {activity.map((a) => (
        <li key={a.id} className="text-xs leading-5 text-[#6b778c]">
          <strong className="font-semibold text-[#172b4d]">
            {personLabel(a.actor_email, a.actor_name)}
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

"use client";

import { useEffect, useState, type ReactNode } from "react";

type Activity = {
  id: string;
  actor_email: string;
  type: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

function describe(a: Activity, personLabel: (email: string) => string): ReactNode {
  const rawTo =
    a.meta && "to" in a.meta ? String((a.meta as { to: unknown }).to ?? "—") : "";
  const to = formatActivityValue(a.type, rawTo, personLabel);

  switch (a.type) {
    case "created": return "created the task";
    case "status_changed": return <>moved to {to}</>;
    case "reopened": return <>reopened ({to})</>;
    case "assigned": return <>assigned to {to}</>;
    case "priority_changed": return <>set priority {to}</>;
    case "category_changed": return "changed category";
    case "agent_changed": return <>changed agent to {to}</>;
    case "comment_added": return "commented";
    case "edited": return "edited the task";
    case "archived": return "archived the task";
    default: return a.type;
  }
}

export function ActivityFeed({
  taskId,
  personLabelByEmail,
}: {
  taskId: string;
  personLabelByEmail?: Map<string, string>;
}) {
  const [items, setItems] = useState<Activity[]>([]);
  const personLabel = (email: string) =>
    personLabelByEmail?.get(email) ?? formatEmailAsName(email);

  useEffect(() => {
    void fetch(`/api/tasks/${taskId}/activity`)
      .then((r) => (r.ok ? r.json() : { activity: [] }))
      .then((d) => setItems(d.activity as Activity[]));
  }, [taskId]);

  if (items.length === 0)
    return <p className="text-xs text-[#6b778c]">No activity yet.</p>;

  return (
    <ul className="space-y-2">
      {items.map((a) => (
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
  if (type === "agent_changed" || type === "assigned") {
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

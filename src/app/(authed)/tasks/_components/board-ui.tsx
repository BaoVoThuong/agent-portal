import {
  ArrowDown,
  ArrowUp,
  ChevronsUp,
  Clock,
  Equal,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { TaskPriority } from "@/lib/tasks/types";
import { formatDurationSeconds, formatSlaRemaining } from "@/lib/tasks/sla";

export const PRIORITY_META: Record<
  TaskPriority,
  {
    label: string;
    description: string;
    color: string;
    softBg: string;
    icon: LucideIcon;
  }
> = {
  low: {
    label: "Low",
    description: "Can wait behind active work",
    color: "#0065ff",
    softBg: "#deebff",
    icon: ArrowDown,
  },
  medium: {
    label: "Medium",
    description: "Normal customer-service priority",
    color: "#ff991f",
    softBg: "#fff0b3",
    icon: Equal,
  },
  high: {
    label: "High",
    description: "Needs attention soon",
    color: "#ff7452",
    softBg: "#ffebe6",
    icon: ArrowUp,
  },
  urgent: {
    label: "Urgent",
    description: "Escalate immediately",
    color: "#de350b",
    softBg: "#ffebe6",
    icon: ChevronsUp,
  },
};

export function PriorityIcon({
  priority,
  className = "h-5 w-5",
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;

  return (
    <Icon
      className={className}
      color={meta.color}
      strokeWidth={2.8}
      aria-label={`${meta.label} priority`}
    />
  );
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const meta = PRIORITY_META[priority];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-bold"
      style={{ backgroundColor: meta.softBg, color: meta.color }}
    >
      <PriorityIcon priority={priority} className="h-4 w-4" />
      {meta.label}
    </span>
  );
}

export function PriorityDot({ priority }: { priority: TaskPriority }) {
  return (
    <span title={PRIORITY_META[priority].label}>
      <PriorityIcon priority={priority} className="h-4 w-4" />
    </span>
  );
}

export function NewAssignedBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded border border-[#85b8ff] bg-[#e9f2ff] px-1.5 text-[10px] font-bold uppercase leading-none text-[#0c66e4] ${className}`}
    >
      New
    </span>
  );
}

// Cumulative time in a stage (To Do / Waiting). `seconds` is the accumulator
// plus the current open stint, precomputed by the caller with the live `now`,
// so it keeps counting across re-entries instead of resetting.
export function StageElapsedBadge({
  label,
  seconds,
}: {
  label: string;
  seconds: number;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-[#f4f5f7] px-1.5 py-0.5 text-[11px] font-bold text-[#44546f]">
      <Clock className="h-3.5 w-3.5" />
      {label} {formatDurationSeconds(seconds)}
    </span>
  );
}

// Consumption-based SLA: `remainingSeconds` = budget − time spent In Progress
// (across all stints). Positive → "X left" countdown; <= 0 → "Overdue by X"
// counting up. `null` means the task isn't In Progress (no timer to show).
export function SlaTimer({
  remainingSeconds,
}: {
  remainingSeconds: number | null;
}) {
  if (remainingSeconds === null) return null;
  const overdue = remainingSeconds <= 0;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${
        overdue ? "bg-[#ffedd5] text-[#c2410c]" : "bg-[#f4f5f7] text-[#44546f]"
      }`}
    >
      <Clock className="h-3.5 w-3.5" />
      {formatSlaRemaining(remainingSeconds)}
    </span>
  );
}

export function Initials({
  email,
  label,
}: {
  email: string | null;
  label?: string | null;
}) {
  if (!email) return null;
  const displayName = label?.trim() || email.split("@")[0];
  const initials = displayName
    .split(/[._-]+/)
    .flatMap((part) => part.split(/\s+/))
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
    .padEnd(2, displayName[0]?.toUpperCase() ?? "U")
    .slice(0, 2);
  const colors = ["#0747a6", "#00875a", "#bf2600", "#403294", "#0065ff"];
  let hash = 0;

  for (const character of email) {
    hash = (hash + character.charCodeAt(0)) % colors.length;
  }

  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white"
      style={{ backgroundColor: colors[hash] }}
      title={label ? `${label} (${email})` : email}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({
  emails,
  labelByEmail,
  max = 3,
}: {
  emails: string[];
  labelByEmail?: Map<string, string>;
  max?: number;
}) {
  if (emails.length === 0) {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[#8590a2] text-[#8590a2]">
        <UserPlus className="h-3.5 w-3.5" />
      </span>
    );
  }

  const visible = emails.slice(0, max);
  const overflow = emails.length - visible.length;
  const title = emails.map((email) => labelByEmail?.get(email) ?? email).join(", ");

  return (
    <span className="inline-flex items-center" title={title}>
      {visible.map((email, index) => (
        <span
          key={email}
          className={index === 0 ? "" : "-ml-2"}
          style={{ zIndex: visible.length - index }}
        >
          <Initials email={email} label={labelByEmail?.get(email) ?? email} />
        </span>
      ))}
      {overflow > 0 ? (
        <span className="-ml-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#dfe1e6] px-1.5 text-[10px] font-bold text-[#42526e] ring-2 ring-white">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

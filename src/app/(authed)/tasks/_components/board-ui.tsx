import type { TaskPriority, WaitingReason } from "@/lib/tasks/types";

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: "bg-slate-300",
  medium: "bg-sky-400",
  high: "bg-amber-500",
  urgent: "bg-red-500",
};

export function PriorityDot({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${PRIORITY_COLOR[priority]}`}
      title={priority}
      aria-label={`priority ${priority}`}
    />
  );
}

export function DueBadge({ due }: { due: string | null }) {
  if (!due) return null;
  const overdue = new Date(`${due}T23:59:59`) < new Date();
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        overdue ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"
      }`}
    >
      {due}
    </span>
  );
}

const WAITING_LABEL: Record<WaitingReason, string> = {
  customer: "waiting: customer",
  carrier: "waiting: carrier",
  documents: "waiting: docs",
  other: "waiting",
};

export function WaitingTag({ reason }: { reason: WaitingReason | null }) {
  if (!reason) return null;
  return (
    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">
      {WAITING_LABEL[reason]}
    </span>
  );
}

export function Initials({ email }: { email: string | null }) {
  if (!email) return null;
  const initials = email.slice(0, 2).toUpperCase();
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0f2849] text-[10px] font-semibold text-white"
      title={email}
    >
      {initials}
    </span>
  );
}

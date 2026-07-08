import type { TaskCategory, TaskRow } from "@/lib/tasks/types";
import { AlertTriangle, CalendarDays, CheckCircle2, Circle, RotateCcw, UserRound } from "lucide-react";
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from "react";
import { Initials, PriorityIcon, SlaTimer } from "./board-ui";

export function TaskCard({
  task,
  category,
  agentLabel,
  assigneeLabelByEmail,
  canReviewDone = false,
  onReviewDone,
  onOpen,
  slaDeadline = null,
  isOverdue = false,
  now = new Date(),
  onUnlockOverdue,
  onReopenRequest,
}: {
  task: TaskRow;
  category?: TaskCategory | null;
  agentLabel?: string | null;
  assigneeLabelByEmail?: Map<string, string>;
  canReviewDone?: boolean;
  onReviewDone?: (id: string, reviewed: boolean) => void;
  onOpen: (id: string) => void;
  slaDeadline?: Date | null;
  isOverdue?: boolean;
  now?: Date;
  onUnlockOverdue?: (id: string) => void;
  onReopenRequest?: (id: string) => void;
}) {
  const isTerminal = task.status === "done" || task.status === "cancel";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen(task.id);
      }}
      className={`block w-full rounded p-3 text-left shadow-[0_1px_2px_rgba(9,30,66,0.16)] transition hover:shadow-[0_2px_8px_rgba(9,30,66,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c66e4] ${
        isOverdue
          ? "border border-l-4 border-[#fed7aa] bg-white hover:border-[#fb923c]"
          : "border border-l-4 border-[#dfe1e6] bg-white hover:border-[#c1c7d0]"
      }`}
      style={{ borderLeftColor: isOverdue ? "#f97316" : STATUS_ACCENT[task.status] }}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-[#172b4d]">
            {task.title}
          </h3>

          {task.assignees.length > 0 ? (
            <div className="mt-2 space-y-0.5">
              {task.assignees.map((email) => {
                const label = assigneeLabelByEmail?.get(email) ?? email;

                return (
                  <div
                    key={email}
                    className="flex min-h-5 min-w-0 items-center gap-1.5 text-xs leading-5 text-[#626f86]"
                    title={label}
                  >
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-[#7a869a]" />
                    <span className="min-w-0 truncate">{label}</span>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div
            className="mt-2 flex min-h-5 min-w-0 items-center gap-1.5 text-xs leading-5 text-[#6b778c]"
            title={`Created ${formatCreatedDate(task.created_at)}`}
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#7a869a]" />
            <span className="min-w-0 truncate">{formatCreatedDate(task.created_at)}</span>
          </div>
        </div>

        <span className="shrink-0">
          <Initials email={task.agent_email} label={agentLabel} />
        </span>
      </div>

      <div className="mt-3 flex min-h-6 flex-wrap items-center gap-1.5">
        <ClosedStatusBadge task={task} />
        <DoneReviewBadge
          task={task}
          canReviewDone={canReviewDone}
          onReviewDone={onReviewDone}
        />
        {category ? (
          <CategoryBadge category={category} />
        ) : (
          <span className="rounded bg-[#ebecf0] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#42526e]">
            General
          </span>
        )}
        <SlaTimer
          deadline={slaDeadline}
          now={now}
          elapsedSinceIso={
            task.overdue_count > 0 && task.status === "in_progress"
              ? task.in_progress_at
              : null
          }
        />
        <WasOverdueBadge task={task} />
        <PriorityAlert priority={task.priority} />
      </div>

      {isOverdue && onUnlockOverdue ? (
        <button
          type="button"
          data-no-dnd="true"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onUnlockOverdue(task.id);
          }}
          className="mt-3 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded border border-[#fdba74] bg-[#fff7ed] text-[11px] font-bold text-[#c2410c] transition hover:border-[#fb923c] hover:bg-[#ffedd5]"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Enter reason to unlock
        </button>
      ) : null}

      {isTerminal && onReopenRequest ? (
        <button
          type="button"
          data-no-dnd="true"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onReopenRequest(task.id);
          }}
          className="mt-2.5 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded border border-[#dfe1e6] bg-white text-[11px] font-bold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reopen
        </button>
      ) : null}
    </div>
  );
}

function ClosedStatusBadge({ task }: { task: TaskRow }) {
  if (task.status !== "done" && task.status !== "cancel") return null;

  const cancelled = task.status === "cancel";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${
        cancelled ? "bg-[#ffebe6] text-[#bf2600]" : "bg-[#e3fcef] text-[#006644]"
      }`}
    >
      {cancelled ? "Cancelled" : "Done"}
    </span>
  );
}

function DoneReviewBadge({
  task,
  canReviewDone,
  onReviewDone,
}: {
  task: TaskRow;
  canReviewDone: boolean;
  onReviewDone?: (id: string, reviewed: boolean) => void;
}) {
  if (task.status !== "done") return null;

  const reviewed = Boolean(task.done_reviewed_at);
  const label = reviewed ? "QC checked" : "Needs QC";
  const icon = reviewed ? (
    <CheckCircle2 className="h-3.5 w-3.5" />
  ) : (
    <Circle className="h-3.5 w-3.5" />
  );
  const className = reviewed
    ? "inline-flex items-center gap-1 rounded bg-[#e3fcef] px-1.5 py-0.5 text-[11px] font-bold text-[#006644]"
    : "inline-flex items-center gap-1 rounded bg-[#fff0b3] px-1.5 py-0.5 text-[11px] font-bold text-[#7f5f01]";
  const stopInteractiveEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };
  const stopDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  if (!canReviewDone || !onReviewDone) {
    return (
      <span
        className={className}
        title={reviewed ? `QC checked by ${task.done_reviewed_by_email}` : "Waiting for agent/admin QC"}
      >
        {icon}
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${className} transition hover:brightness-95`}
      title={reviewed ? "Clear QC check" : "Mark QC checked"}
      data-no-dnd="true"
      onPointerDown={stopDragStart}
      onMouseDown={stopInteractiveEvent}
      onTouchStart={stopInteractiveEvent}
      onDoubleClick={stopInteractiveEvent}
      onKeyDown={stopInteractiveEvent}
      onClick={(event) => {
        event.stopPropagation();
        onReviewDone(task.id, !reviewed);
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function formatCreatedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function CategoryBadge({ category }: { category: TaskCategory }) {
  const palette = categoryPalette(category);

  return (
    <span
      className="max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-semibold"
      style={{
        backgroundColor: palette.background,
        color: palette.foreground,
      }}
    >
      {category.name}
    </span>
  );
}

// Permanent marker for Done/Cancel cards that were overdue at some point —
// the live overdue check goes blank the moment status leaves in_progress, so
// without this a task that dodged its SLA for days would look completely
// clean once finished.
function WasOverdueBadge({ task }: { task: TaskRow }) {
  if (task.status !== "done" && task.status !== "cancel") return null;
  if (task.overdue_count <= 0) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-[#fff0b3] px-1.5 py-0.5 text-[11px] font-bold text-[#7f5f01]"
      title="This task went overdue at least once before it was closed."
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      Was overdue{task.overdue_count > 1 ? ` ${task.overdue_count}x` : ""}
    </span>
  );
}

function PriorityAlert({ priority }: { priority: TaskRow["priority"] }) {
  if (priority !== "urgent" && priority !== "high") return null;

  const label = priority === "urgent" ? "Urgent" : "High";

  return (
    <span className="inline-flex items-center gap-1 rounded bg-[#ffebe6] px-1.5 py-0.5 text-[11px] font-bold text-[#de350b]">
      <PriorityIcon priority={priority} className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

const STATUS_ACCENT: Record<TaskRow["status"], string> = {
  backlog: "#a5adba",
  todo: "#4c9aff",
  in_progress: "#6554c0",
  waiting: "#ffab00",
  done: "#36b37e",
  cancel: "#5e6c84",
};

function categoryPalette(category: TaskCategory) {
  if (category.color && /^#[0-9a-f]{6}$/i.test(category.color)) {
    return {
      background: category.color,
      foreground: readableTextColor(category.color),
    };
  }

  const palettes = [
    { background: "#ffab00", foreground: "#172b4d" },
    { background: "#ff7452", foreground: "#ffffff" },
    { background: "#00b8d9", foreground: "#ffffff" },
    { background: "#6554c0", foreground: "#ffffff" },
    { background: "#36b37e", foreground: "#ffffff" },
  ];
  let hash = 0;

  for (const character of category.id || category.name) {
    hash = (hash + character.charCodeAt(0)) % palettes.length;
  }

  return palettes[hash];
}

function readableTextColor(background: string) {
  const red = Number.parseInt(background.slice(1, 3), 16);
  const green = Number.parseInt(background.slice(3, 5), 16);
  const blue = Number.parseInt(background.slice(5, 7), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.62 ? "#172b4d" : "#ffffff";
}

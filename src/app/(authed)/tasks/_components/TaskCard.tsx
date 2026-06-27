import { UserRound } from "lucide-react";
import type { TaskCategory, TaskRow } from "@/lib/tasks/types";
import { WaitingTag, Initials, PriorityIcon } from "./board-ui";

export function TaskCard({
  task,
  category,
  agentLabel,
  assigneeLabel,
  onOpen,
}: {
  task: TaskRow;
  category?: TaskCategory | null;
  agentLabel?: string | null;
  assigneeLabel?: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className="block w-full rounded border border-l-4 border-[#dfe1e6] bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(9,30,66,0.16)] transition hover:border-[#c1c7d0] hover:bg-[#fefefe] hover:shadow-[0_2px_8px_rgba(9,30,66,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c66e4]"
      style={{ borderLeftColor: statusAccent(task.status) }}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-5 text-[#172b4d]">
            {task.title}
          </h3>

          {task.agent_email ? (
            <div className="mt-2 flex min-h-5 items-center gap-1.5 text-xs leading-5 text-[#626f86]">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-[#7a869a]" />
              <span className="min-w-0 truncate" title={task.agent_email}>
                {agentLabel ?? task.agent_email}
              </span>
            </div>
          ) : null}
        </div>

        <span className="shrink-0">
          <Initials email={task.assignee_email} label={assigneeLabel} />
        </span>
      </div>

      <div className="mt-3 flex min-h-6 flex-wrap items-center gap-1.5">
        {category ? (
          <CategoryBadge category={category} />
        ) : (
          <span className="rounded bg-[#ebecf0] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#42526e]">
            General
          </span>
        )}
        <WaitingTag reason={task.waiting_reason} />
        <PriorityAlert priority={task.priority} />
      </div>
    </button>
  );
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

function statusAccent(status: TaskRow["status"]) {
  const colors: Record<TaskRow["status"], string> = {
    backlog: "#a5adba",
    todo: "#4c9aff",
    in_progress: "#6554c0",
    waiting: "#ffab00",
    done: "#36b37e",
    cancel: "#de350b",
  };

  return colors[status];
}

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

import {
  Bookmark,
  CheckSquare,
  UserRound,
} from "lucide-react";
import type { TaskCategory, TaskPriority, TaskRow } from "@/lib/tasks/types";
import { DueBadge, WaitingTag, Initials, PriorityIcon } from "./board-ui";

export function TaskCard({
  task,
  category,
  onOpen,
}: {
  task: TaskRow;
  category?: TaskCategory | null;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className="block w-full rounded border border-[#dfe1e6] bg-white p-4 text-left shadow-[0_1px_2px_rgba(9,30,66,0.2)] transition hover:bg-[#fefefe] hover:shadow-[0_2px_8px_rgba(9,30,66,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c66e4]"
    >
      <h3 className="text-[15px] font-medium leading-5 text-[#253858]">
        {task.title}
      </h3>

      {task.agent_email ? (
        <div className="mt-3 flex min-h-5 items-center gap-1.5 text-xs leading-5 text-[#626f86]">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-[#7a869a]" />
          <span className="min-w-0 truncate">{task.agent_email}</span>
        </div>
      ) : null}

      <div className="mt-4 flex min-h-6 flex-wrap items-center gap-2">
        {category ? (
          <CategoryBadge category={category} />
        ) : (
          <span className="rounded bg-[#ebecf0] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#42526e]">
            General
          </span>
        )}
        <WaitingTag reason={task.waiting_reason} />
        <DueBadge due={task.due_date} />
      </div>

      <div className="mt-4 flex items-center gap-2 text-[#6b778c]">
        <IssueTypeIcon status={task.status} />
        <PriorityIcon priority={task.priority} />
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ebecf0] px-1.5 text-xs font-bold text-[#42526e]">
          {priorityPoints(task.priority)}
        </span>
        <span className="ml-auto text-xs font-bold text-[#97a0af]">
          {ticketKey(task.id)}
        </span>
        <span className="shrink-0">
          <Initials email={task.assignee_email} />
        </span>
      </div>
    </button>
  );
}

function CategoryBadge({ category }: { category: TaskCategory }) {
  const palette = categoryPalette(category);

  return (
    <span
      className="rounded px-1.5 py-0.5 text-[11px] font-bold uppercase"
      style={{
        backgroundColor: palette.background,
        color: palette.foreground,
      }}
    >
      {category.name}
    </span>
  );
}

function IssueTypeIcon({ status }: { status: TaskRow["status"] }) {
  if (status === "done") {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#36b37e] text-white">
        <CheckSquare className="h-3.5 w-3.5" />
      </span>
    );
  }

  if (status === "waiting") {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#ffab00] text-white">
        <Bookmark className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#4c9aff] text-white">
      <CheckSquare className="h-3.5 w-3.5" />
    </span>
  );
}

function priorityPoints(priority: TaskPriority) {
  const points: Record<TaskPriority, number> = {
    low: 2,
    medium: 3,
    high: 5,
    urgent: 8,
  };

  return points[priority];
}

function ticketKey(id: string) {
  let hash = 0;

  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) % 900;
  }

  return `TASK-${hash + 100}`;
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

import type { TaskRow } from "@/lib/tasks/types";
import { PriorityDot, DueBadge, WaitingTag, Initials } from "./board-ui";

export function TaskCard({
  task,
  categoryName,
  onOpen,
}: {
  task: TaskRow;
  categoryName?: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className="block w-full rounded-lg border border-slate-200 bg-white p-2.5 text-left shadow-sm transition hover:border-[#0f2849]/30"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{task.title}</span>
        <PriorityDot priority={task.priority} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {categoryName && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
            {categoryName}
          </span>
        )}
        <WaitingTag reason={task.waiting_reason} />
        <DueBadge due={task.due_date} />
        <span className="ml-auto">
          <Initials email={task.assignee_email} />
        </span>
      </div>
    </button>
  );
}

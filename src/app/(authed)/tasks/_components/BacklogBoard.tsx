"use client";

import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus } from "lucide-react";
import { midpoint } from "@/lib/tasks/ordering";
import { taskKey } from "@/lib/tasks/sorting";
import type { TaskCategory, TaskRow } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import type { NewTaskPayload } from "./NewTaskDialog";
import { TaskSelect } from "./TaskSelect";
import { PriorityIcon, DueBadge } from "./board-ui";

export function BacklogBoard({
  tasks,
  assignees,
  categories,
  onOpen,
  onAssign,
  onReorder,
  onCreate,
}: {
  tasks: TaskRow[];
  assignees: TaskAssignee[];
  categories: TaskCategory[];
  onOpen: (id: string) => void;
  onAssign: (taskId: string, email: string) => void;
  onReorder: (taskId: string, position: number) => void;
  onCreate: (payload: NewTaskPayload) => Promise<void>;
}) {
  const backlog = tasks
    .filter((t) => t.status === "backlog")
    .sort((a, b) => a.position - b.position);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? null;
  const assigneeOptions = [
    { value: "", label: "Assign…" },
    ...assignees.map((a) => ({ value: a.email, label: a.name ?? a.email })),
  ];

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = backlog.map((t) => t.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(backlog, oldIndex, newIndex);
    const idx = reordered.findIndex((t) => t.id === String(active.id));
    const before = idx > 0 ? reordered[idx - 1].position : null;
    const after = idx < reordered.length - 1 ? reordered[idx + 1].position : null;
    onReorder(String(active.id), midpoint(before, after));
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
      <div className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
        <div className="border-b border-[#dfe1e6] bg-[#f4f5f7] px-4 py-3 text-xs font-bold uppercase text-[#6b778c]">
          Backlog {backlog.length}
        </div>

        {backlog.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm font-semibold text-[#6b778c]">
            Backlog is empty. Add the first task below.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={backlog.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="divide-y divide-[#ebecf0]">
                {backlog.map((task) => (
                  <BacklogRow
                    key={task.id}
                    task={task}
                    categoryName={categoryName(task.category_id)}
                    assigneeOptions={assigneeOptions}
                    onOpen={onOpen}
                    onAssign={onAssign}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        <InlineCreateRow onCreate={onCreate} />
      </div>
    </div>
  );
}

function BacklogRow({
  task,
  categoryName,
  assigneeOptions,
  onOpen,
  onAssign,
}: {
  task: TaskRow;
  categoryName: string | null;
  assigneeOptions: { value: string; label: string }[];
  onOpen: (id: string) => void;
  onAssign: (taskId: string, email: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-2 bg-white px-3 py-2.5 transition hover:bg-[#f4f5f7]"
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="shrink-0 cursor-grab text-[#97a0af] hover:text-[#42526e] active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <PriorityIcon priority={task.priority} />
      <span className="shrink-0 font-mono text-xs font-bold text-[#97a0af]">
        {taskKey(task.id)}
      </span>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[#253858] hover:text-[#0c66e4]"
      >
        {task.title}
      </button>
      {categoryName ? (
        <span className="hidden shrink-0 rounded bg-[#ebecf0] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#42526e] sm:inline">
          {categoryName}
        </span>
      ) : null}
      {task.agent_email ? (
        <span className="hidden min-w-0 max-w-[10rem] shrink-0 truncate text-xs text-[#6b778c] md:inline">
          {task.agent_email}
        </span>
      ) : null}
      <DueBadge due={task.due_date} />
      <TaskSelect
        label="Assign"
        value=""
        options={assigneeOptions}
        align="right"
        className="w-40 shrink-0"
        buttonClassName="h-8 border-[#dfe1e6] shadow-none"
        onChange={(email) => email && onAssign(task.id, email)}
      />
    </li>
  );
}

function InlineCreateRow({
  onCreate,
}: {
  onCreate: (payload: NewTaskPayload) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onCreate({
        title: trimmed,
        description: "",
        priority: "medium",
        due_date: "",
      });
      setTitle("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 border-t border-[#ebecf0] bg-[#fafbfc] px-3 py-2.5">
      <Plus className="h-4 w-4 shrink-0 text-[#6b778c]" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        onBlur={() => void submit()}
        disabled={saving}
        placeholder="Create a task and press Enter"
        className="min-w-0 flex-1 bg-transparent text-sm text-[#172b4d] outline-none placeholder:text-[#7a869a] disabled:opacity-60"
      />
    </div>
  );
}

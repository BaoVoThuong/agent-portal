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
import type { TaskCategory, TaskRow } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import type { NewTaskPayload } from "./NewTaskDialog";
import { TaskRowItem } from "./TaskRowItem";

export function BacklogBoard({
  tasks,
  assignees,
  categories,
  onOpen,
  onPatch,
  onReorder,
  onCreate,
}: {
  tasks: TaskRow[];
  assignees: TaskAssignee[];
  categories: TaskCategory[];
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onReorder: (taskId: string, position: number) => void;
  onCreate: (payload: NewTaskPayload) => Promise<void>;
}) {
  const backlog = tasks
    .filter((t) => t.status === "backlog")
    .sort((a, b) => a.position - b.position);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

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
                  <BacklogSortableRow
                    key={task.id}
                    task={task}
                    category={categoryById.get(task.category_id ?? "") ?? null}
                    assignees={assignees}
                    onOpen={onOpen}
                    onPatch={onPatch}
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

function BacklogSortableRow({
  task,
  category,
  assignees,
  onOpen,
  onPatch,
}: {
  task: TaskRow;
  category: TaskCategory | null;
  assignees: TaskAssignee[];
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
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
    >
      <TaskRowItem
        task={task}
        category={category}
        assignees={assignees}
        canEdit
        canAssign
        onOpen={onOpen}
        onPatch={onPatch}
        dragHandle={
          <button
            type="button"
            aria-label="Drag to reorder"
            className="shrink-0 cursor-grab text-[#97a0af] hover:text-[#42526e] active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        }
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
    <div className="flex items-center gap-2 border-t border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5">
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

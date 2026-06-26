"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  KANBAN_STATUSES,
  type TaskRow,
  type TaskStatus,
  type TaskCategory,
} from "@/lib/tasks/types";
import { midpoint } from "@/lib/tasks/ordering";
import { TaskCard } from "./TaskCard";

const COLUMN_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  waiting: "Waiting",
  done: "Done",
};

function byPosition(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort((a, b) => a.position - b.position);
}

// The column a draggable id currently belongs to. Column drop zones use the id
// `col:<status>`; cards use their task id.
function findContainer(id: string, items: TaskRow[]): TaskStatus | null {
  if (id.startsWith("col:")) return id.slice(4) as TaskStatus;
  return items.find((task) => task.id === id)?.status ?? null;
}

// Index just after the last card of a status (where an appended card lands).
function endIndexOfStatus(items: TaskRow[], status: TaskStatus): number {
  let lastIndex = -1;
  items.forEach((task, index) => {
    if (task.status === status) lastIndex = index;
  });
  return lastIndex === -1 ? items.length : lastIndex + 1;
}

function SortableCard({
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // While dragging, the original keeps its space as an empty placeholder;
        // the live card is rendered in the DragOverlay instead.
        opacity: isDragging ? 0 : 1,
      }}
      {...attributes}
      {...listeners}
      className="mb-2"
    >
      <TaskCard
        task={task}
        category={category}
        agentLabel={agentLabel}
        assigneeLabel={assigneeLabel}
        onOpen={onOpen}
      />
    </div>
  );
}

function Column({
  status,
  tasks,
  onOpen,
  categoryById,
  agentLabelByEmail,
  assigneeLabelByEmail,
}: {
  status: TaskStatus;
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  categoryById: Map<string, TaskCategory>;
  agentLabelByEmail: Map<string, string>;
  assigneeLabelByEmail: Map<string, string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  return (
    <section className="flex min-w-0 flex-1 flex-col rounded bg-[#f4f5f7] p-1.5">
      <div className="flex h-9 items-center px-1">
        <span className="text-xs font-bold uppercase text-[#6b778c]">
          {COLUMN_LABEL[status]}
        </span>
        <span className="ml-1 text-xs font-bold text-[#6b778c]">
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto rounded px-0.5 pb-1 transition-colors ${
          isOver ? "bg-[#deebff]" : ""
        }`}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((t) => (
            <SortableCard
              key={t.id}
              task={t}
              category={t.category_id ? categoryById.get(t.category_id) : null}
              agentLabel={
                t.agent_email
                  ? agentLabelByEmail.get(t.agent_email) ?? t.agent_email
                  : null
              }
              assigneeLabel={
                t.assignee_email
                  ? assigneeLabelByEmail.get(t.assignee_email) ??
                    t.assignee_email
                  : null
              }
              onOpen={onOpen}
            />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}

export function KanbanBoard({
  tasks,
  onOpen,
  onMove,
  categories,
  agentLabelByEmail,
  assigneeLabelByEmail,
}: {
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  onMove: (taskId: string, change: { status: TaskStatus; position: number }) => void;
  categories: TaskCategory[];
  agentLabelByEmail: Map<string, string>;
  assigneeLabelByEmail: Map<string, string>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const sortedTasks = useMemo(() => byPosition(tasks), [tasks]);
  // Local ordered mirror used only while dragging so the board can reflow live.
  const [dragItems, setDragItems] = useState<TaskRow[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const items = dragItems ?? sortedTasks;

  const columnTasks = (status: TaskStatus) =>
    items.filter((task) => task.status === status);

  const activeTask = activeId
    ? items.find((task) => task.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setDragItems(sortedTasks);
    setActiveId(String(event.active.id));
  }

  // Live cross-column move: when the dragged card hovers a different column,
  // splice it into that column immediately so the board reflows under the cursor.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    setDragItems((prev) => {
      const current = prev ?? sortedTasks;
      const activeContainer = findContainer(activeId, current);
      const overContainer = findContainer(overId, current);
      if (!activeContainer || !overContainer || activeContainer === overContainer) {
        return current;
      }

      const activeIndex = current.findIndex((task) => task.id === activeId);
      if (activeIndex === -1) return current;

      const next = [...current];
      const [moved] = next.splice(activeIndex, 1);
      const movedUpdated: TaskRow = { ...moved, status: overContainer };

      let insertIndex: number;
      if (overId.startsWith("col:")) {
        insertIndex = endIndexOfStatus(next, overContainer);
      } else {
        const overIndex = next.findIndex((task) => task.id === overId);
        insertIndex =
          overIndex === -1 ? endIndexOfStatus(next, overContainer) : overIndex;
      }

      next.splice(insertIndex, 0, movedUpdated);
      return next;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setDragItems(null);
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Same-column reorder commits here (cross-column already happened on hover).
    let working = items;
    const activeContainer = findContainer(activeId, items);
    const overContainer = findContainer(overId, items);
    if (
      activeContainer &&
      overContainer &&
      activeContainer === overContainer &&
      !overId.startsWith("col:")
    ) {
      const activeIndex = items.findIndex((task) => task.id === activeId);
      const overIndex = items.findIndex((task) => task.id === overId);
      if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
        working = arrayMove(items, activeIndex, overIndex);
      }
    }

    const moving = working.find((task) => task.id === activeId);
    if (!moving) return;

    // New position = midpoint of the neighbours in the destination column.
    const column = working.filter((task) => task.status === moving.status);
    const index = column.findIndex((task) => task.id === activeId);
    const before = index > 0 ? column[index - 1].position : null;
    const after = index < column.length - 1 ? column[index + 1].position : null;
    const position = midpoint(before, after);

    const original = tasks.find((task) => task.id === activeId);
    if (
      original &&
      original.status === moving.status &&
      original.position === position
    ) {
      return;
    }

    onMove(activeId, { status: moving.status, position });
  }

  return (
    <DndContext
      id="kanban-board"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragItems(null);
      }}
    >
      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-6">
        {KANBAN_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={columnTasks(status)}
            onOpen={onOpen}
            categoryById={categoryById}
            agentLabelByEmail={agentLabelByEmail}
            assigneeLabelByEmail={assigneeLabelByEmail}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeTask ? (
          <div className="rotate-2 cursor-grabbing opacity-95 shadow-[0_12px_28px_rgba(9,30,66,0.28)]">
            <TaskCard
              task={activeTask}
              category={
                activeTask.category_id
                  ? categoryById.get(activeTask.category_id)
                  : null
              }
              agentLabel={
                activeTask.agent_email
                  ? agentLabelByEmail.get(activeTask.agent_email) ??
                    activeTask.agent_email
                  : null
              }
              assigneeLabel={
                activeTask.assignee_email
                  ? assigneeLabelByEmail.get(activeTask.assignee_email) ??
                    activeTask.assignee_email
                  : null
              }
              onOpen={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

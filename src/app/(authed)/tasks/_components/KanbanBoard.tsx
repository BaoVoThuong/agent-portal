"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KANBAN_STATUSES, type TaskRow, type TaskStatus, type TaskCategory } from "@/lib/tasks/types";
import { midpoint } from "@/lib/tasks/ordering";
import { TaskCard } from "./TaskCard";

const COLUMN_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  waiting: "Waiting",
  done: "Done",
};

function SortableCard({
  task,
  category,
  onOpen,
}: {
  task: TaskRow;
  category?: TaskCategory | null;
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
        opacity: isDragging ? 0.58 : 1,
      }}
      {...attributes}
      {...listeners}
      className="mb-2"
    >
      <TaskCard task={task} category={category} onOpen={onOpen} />
    </div>
  );
}

function Column({
  status,
  tasks,
  onOpen,
  categoryById,
}: {
  status: TaskStatus;
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  categoryById: Map<string, TaskCategory>;
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
        className={`flex-1 overflow-y-auto rounded px-0.5 pb-1 transition ${
          isOver ? "bg-[#deebff]" : ""
        }`}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <SortableCard
              key={t.id}
              task={t}
              category={t.category_id ? categoryById.get(t.category_id) : null}
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
}: {
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  onMove: (taskId: string, change: { status: TaskStatus; position: number }) => void;
  categories: TaskCategory[];
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const byStatus = (s: TaskStatus) =>
    tasks.filter((t) => t.status === s).sort((a, b) => a.position - b.position);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const moving = tasks.find((t) => t.id === activeId);
    if (!moving) return;

    // Destination status: dropped on a column area, or onto another card.
    let destStatus: TaskStatus;
    if (overId.startsWith("col:")) {
      destStatus = overId.slice(4) as TaskStatus;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      destStatus = overTask.status;
    }

    const dest = byStatus(destStatus).filter((t) => t.id !== activeId);
    // Index where it was dropped.
    let index = dest.length;
    if (!overId.startsWith("col:")) {
      const overIdx = dest.findIndex((t) => t.id === overId);
      if (overIdx !== -1) index = overIdx;
    }
    const before = index > 0 ? dest[index - 1].position : null;
    const after = index < dest.length ? dest[index].position : null;
    const position = midpoint(before, after);

    if (destStatus === moving.status && position === moving.position) return;
    onMove(activeId, { status: destStatus, position });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-6">
        {KANBAN_STATUSES.map((s) => (
          <Column
            key={s}
            status={s}
            tasks={byStatus(s)}
            onOpen={onOpen}
            categoryById={categoryById}
          />
        ))}
      </div>
    </DndContext>
  );
}

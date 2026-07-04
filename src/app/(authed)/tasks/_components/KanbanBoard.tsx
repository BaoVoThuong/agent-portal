"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
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
  BOARD_COLUMN_LABEL,
  KANBAN_COLUMNS,
  type BoardColumn,
  type TaskRow,
  type TaskStatus,
  type TaskCategory,
  type TaskSlaRule,
} from "@/lib/tasks/types";
import { isTaskOverdue, resolveSlaMinutes, slaDeadline } from "@/lib/tasks/sla";
import { midpoint } from "@/lib/tasks/ordering";
import { TaskCard } from "./TaskCard";

function byPosition(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort((a, b) => a.position - b.position);
}

// The board column a draggable id currently belongs to. Column drop zones use
// the id `col:<column>`; cards use their task id. "overdue" is a computed
// bucket, never a real status, so it can never be the resolved container for
// a card that's actually being moved (see the drag handlers below).
function findContainer(
  id: string,
  items: TaskRow[],
  columnOf: (task: TaskRow) => BoardColumn
): BoardColumn | null {
  if (id.startsWith("col:")) return id.slice(4) as BoardColumn;
  const task = items.find((t) => t.id === id);
  return task ? columnOf(task) : null;
}

// Index just after the last card of a status (where an appended card lands).
function endIndexOfStatus(items: TaskRow[], status: TaskStatus): number {
  let lastIndex = -1;
  items.forEach((task, index) => {
    if (task.status === status) lastIndex = index;
  });
  return lastIndex === -1 ? items.length : lastIndex + 1;
}

function isColumnId(id: unknown): boolean {
  return String(id).startsWith("col:");
}

const kanbanCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args).filter(
    (collision) => collision.id !== args.active.id
  );

  if (pointerCollisions.length > 0) {
    const cardCollisions = pointerCollisions.filter(
      (collision) => !isColumnId(collision.id)
    );
    if (cardCollisions.length > 0) return cardCollisions;

    const columnCollisions = pointerCollisions.filter((collision) =>
      isColumnId(collision.id)
    );
    if (columnCollisions.length > 0) return columnCollisions;
  }

  return closestCorners(args);
};

function SortableCard({
  task,
  category,
  agentLabel,
  assigneeLabelByEmail,
  canReviewDone,
  onReviewDone,
  canMove,
  onOpen,
  slaDeadline,
  isOverdue,
  now,
  onUnlockOverdue,
}: {
  task: TaskRow;
  category?: TaskCategory | null;
  agentLabel?: string | null;
  assigneeLabelByEmail: Map<string, string>;
  canReviewDone: boolean;
  onReviewDone: (taskId: string, reviewed: boolean) => void;
  canMove: boolean;
  onOpen: (id: string) => void;
  slaDeadline: Date | null;
  isOverdue: boolean;
  now: Date;
  onUnlockOverdue: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, disabled: !canMove });
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
      {...(canMove ? attributes : {})}
      {...(canMove ? listeners : {})}
      className="mb-2"
    >
      <TaskCard
        task={task}
        category={category}
        agentLabel={agentLabel}
        assigneeLabelByEmail={assigneeLabelByEmail}
        canReviewDone={canReviewDone}
        onReviewDone={onReviewDone}
        onOpen={onOpen}
        slaDeadline={slaDeadline}
        isOverdue={isOverdue}
        now={now}
        onUnlockOverdue={onUnlockOverdue}
      />
    </div>
  );
}

function Column({
  column,
  tasks,
  onOpen,
  canMoveTask,
  categoryById,
  agentLabelByEmail,
  assigneeLabelByEmail,
  canReviewDoneTask,
  onReviewDone,
  slaDeadlineFor,
  now,
  onUnlockOverdue,
}: {
  column: BoardColumn;
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  canMoveTask: (task: TaskRow) => boolean;
  canReviewDoneTask: (task: TaskRow) => boolean;
  onReviewDone: (taskId: string, reviewed: boolean) => void;
  categoryById: Map<string, TaskCategory>;
  agentLabelByEmail: Map<string, string>;
  assigneeLabelByEmail: Map<string, string>;
  slaDeadlineFor: (task: TaskRow) => Date | null;
  now: Date;
  onUnlockOverdue: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column}` });
  const isOverdueColumn = column === "overdue";
  return (
    <section
      ref={setNodeRef}
      className={`flex min-w-0 flex-1 flex-col rounded p-1.5 transition-colors ${
        isOverdueColumn ? "bg-[#fff0ee]" : "bg-[#f4f5f7]"
      } ${isOver && !isOverdueColumn ? "bg-[#deebff]" : ""}`}
    >
      <div className="flex h-9 items-center px-1">
        <span
          className={`text-xs font-bold uppercase ${
            isOverdueColumn ? "text-[#bf2600]" : "text-[#6b778c]"
          }`}
        >
          {BOARD_COLUMN_LABEL[column]}
        </span>
        <span
          className={`ml-1 text-xs font-bold ${
            isOverdueColumn ? "text-[#bf2600]" : "text-[#6b778c]"
          }`}
        >
          {tasks.length}
        </span>
      </div>
      <div
        className="min-h-[12rem] flex-1 overflow-y-auto rounded px-0.5 pb-1"
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
              assigneeLabelByEmail={assigneeLabelByEmail}
              canReviewDone={canReviewDoneTask(t)}
              onReviewDone={onReviewDone}
              canMove={!isOverdueColumn && canMoveTask(t)}
              onOpen={onOpen}
              slaDeadline={slaDeadlineFor(t)}
              isOverdue={isOverdueColumn}
              now={now}
              onUnlockOverdue={onUnlockOverdue}
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
  canMoveTask,
  canReviewDoneTask,
  onReviewDone,
  categories,
  agentLabelByEmail,
  assigneeLabelByEmail,
  rules,
  now,
  onUnlockOverdue,
}: {
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  onMove: (taskId: string, change: { status: TaskStatus; position: number }) => void;
  canMoveTask: (task: TaskRow) => boolean;
  canReviewDoneTask: (task: TaskRow) => boolean;
  onReviewDone: (taskId: string, reviewed: boolean) => void;
  categories: TaskCategory[];
  agentLabelByEmail: Map<string, string>;
  assigneeLabelByEmail: Map<string, string>;
  rules: TaskSlaRule[];
  now: Date;
  onUnlockOverdue: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const isOverdueTask = (task: TaskRow) => isTaskOverdue(task, rules, now);
  const slaDeadlineFor = (task: TaskRow): Date | null => {
    if (task.status !== "in_progress" || !task.in_progress_at) return null;
    const minutes = resolveSlaMinutes(task.priority, task.category_id, rules);
    return slaDeadline(task.in_progress_at, minutes);
  };
  // Kanban never receives backlog tasks (Backlog is a separate view), but
  // TaskStatus includes it — narrow it away so the fallback return type-checks.
  const columnOf = (task: TaskRow): BoardColumn => {
    if (task.status === "in_progress" && isOverdueTask(task)) return "overdue";
    if (task.status === "backlog") return "todo";
    return task.status;
  };

  const sortedTasks = useMemo(() => byPosition(tasks), [tasks]);
  // Local ordered mirror used only while dragging so the board can reflow live.
  const [dragItems, setDragItems] = useState<TaskRow[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const items = dragItems ?? sortedTasks;

  const columnTasks = (column: BoardColumn) =>
    items.filter((task) => columnOf(task) === column);

  const activeTask = activeId
    ? items.find((task) => task.id === activeId) ?? null
    : null;

  function canDragTask(task: TaskRow): boolean {
    return canMoveTask(task) && !isOverdueTask(task);
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const task = sortedTasks.find((item) => item.id === id);
    if (!task || !canDragTask(task)) return;
    setDragItems(sortedTasks);
    setActiveId(id);
  }

  // Live cross-column move: when the dragged card hovers a different column,
  // splice it into that column immediately so the board reflows under the cursor.
  // "Overdue" is a computed bucket, not a real status — dropping there is a no-op.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const original = tasks.find((task) => task.id === activeId);
    if (!original || !canDragTask(original)) return;

    setDragItems((prev) => {
      const current = prev ?? sortedTasks;
      const activeContainer = findContainer(activeId, current, columnOf);
      const overContainer = findContainer(overId, current, columnOf);
      if (
        !activeContainer ||
        !overContainer ||
        activeContainer === overContainer ||
        overContainer === "overdue"
      ) {
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
    const original = tasks.find((task) => task.id === activeId);
    if (!original || !canDragTask(original)) return;

    // Same-column reorder commits here (cross-column already happened on hover).
    let working = items;
    const activeContainer = findContainer(activeId, items, columnOf);
    const overContainer = findContainer(overId, items, columnOf);
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
      collisionDetection={kanbanCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragItems(null);
      }}
    >
      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-6">
        {KANBAN_COLUMNS.map((column) => (
          <Column
            key={column}
            column={column}
            tasks={columnTasks(column)}
            onOpen={onOpen}
            canMoveTask={canMoveTask}
            canReviewDoneTask={canReviewDoneTask}
            onReviewDone={onReviewDone}
            categoryById={categoryById}
            agentLabelByEmail={agentLabelByEmail}
            assigneeLabelByEmail={assigneeLabelByEmail}
            slaDeadlineFor={slaDeadlineFor}
            now={now}
            onUnlockOverdue={onUnlockOverdue}
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
              assigneeLabelByEmail={assigneeLabelByEmail}
              canReviewDone={false}
              onReviewDone={onReviewDone}
              onOpen={() => {}}
              slaDeadline={slaDeadlineFor(activeTask)}
              now={now}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

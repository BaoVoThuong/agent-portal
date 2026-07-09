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
import { AlertTriangle } from "lucide-react";
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
import { effectiveSlaMinutes, isTaskOverdue, slaDeadline } from "@/lib/tasks/sla";
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

function statusForDropColumn(column: BoardColumn): TaskStatus | null {
  if (column === "overdue") return null;
  if (column === "closed") return "done";
  return column;
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
  assigneeLabelByEmail,
  canReviewDone,
  onReviewDone,
  canMove,
  onOpen,
  slaDeadline,
  isOverdue,
  isNewAssigned,
  useAssigneeTodoClock,
  now,
  onUnlockOverdue,
  onReopenRequest,
}: {
  task: TaskRow;
  category?: TaskCategory | null;
  assigneeLabelByEmail: Map<string, string>;
  canReviewDone: boolean;
  onReviewDone: (taskId: string, reviewed: boolean) => void;
  canMove: boolean;
  onOpen: (id: string) => void;
  slaDeadline: Date | null;
  isOverdue: boolean;
  isNewAssigned: boolean;
  useAssigneeTodoClock: boolean;
  now: Date;
  onUnlockOverdue: (id: string) => void;
  onReopenRequest: (id: string) => void;
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
        assigneeLabelByEmail={assigneeLabelByEmail}
        canReviewDone={canReviewDone}
        onReviewDone={onReviewDone}
        onOpen={onOpen}
        slaDeadline={slaDeadline}
        isOverdue={isOverdue}
        isNewAssigned={isNewAssigned}
        useAssigneeTodoClock={useAssigneeTodoClock}
        now={now}
        onUnlockOverdue={onUnlockOverdue}
        onReopenRequest={onReopenRequest}
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
  assigneeLabelByEmail,
  canReviewDoneTask,
  onReviewDone,
  slaDeadlineFor,
  newAssignedTaskIds,
  useAssigneeTodoClock,
  now,
  onUnlockOverdue,
  onReopenRequest,
}: {
  column: BoardColumn;
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  canMoveTask: (task: TaskRow) => boolean;
  canReviewDoneTask: (task: TaskRow) => boolean;
  onReviewDone: (taskId: string, reviewed: boolean) => void;
  categoryById: Map<string, TaskCategory>;
  assigneeLabelByEmail: Map<string, string>;
  slaDeadlineFor: (task: TaskRow) => Date | null;
  newAssignedTaskIds: Set<string>;
  useAssigneeTodoClock: boolean;
  now: Date;
  onUnlockOverdue: (id: string) => void;
  onReopenRequest: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column}` });
  const isOverdueColumn = column === "overdue";
  const isTerminalColumn = column === "closed";

  return (
    <section
      ref={setNodeRef}
      className={`flex min-w-0 flex-1 flex-col rounded border border-transparent bg-[#f4f5f7] p-1.5 transition-colors ${
        isOver && !isOverdueColumn ? "bg-[#deebff]" : ""
      }`}
    >
      <div className="flex h-9 items-center px-1">
        {isOverdueColumn ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-bold uppercase text-[#c2410c]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{BOARD_COLUMN_LABEL[column]}</span>
            <span className="rounded-full bg-[#ffedd5] px-1.5 py-0.5 text-[10px] leading-none text-[#9a3412]">
              {tasks.length}
            </span>
          </span>
        ) : (
          <>
            <span className="text-xs font-bold uppercase text-[#6b778c]">
              {BOARD_COLUMN_LABEL[column]}
            </span>
            <span className="ml-1 text-xs font-bold text-[#6b778c]">
              {tasks.length}
            </span>
          </>
        )}
      </div>
      <div className="min-h-[12rem] flex-1 overflow-y-auto rounded px-0.5 pb-1">
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((t) => (
            <SortableCard
              key={t.id}
              task={t}
              category={t.category_id ? categoryById.get(t.category_id) : null}
              assigneeLabelByEmail={assigneeLabelByEmail}
              canReviewDone={canReviewDoneTask(t)}
              onReviewDone={onReviewDone}
              canMove={!isOverdueColumn && !isTerminalColumn && canMoveTask(t)}
              onOpen={onOpen}
              slaDeadline={slaDeadlineFor(t)}
              isOverdue={isOverdueColumn}
              isNewAssigned={newAssignedTaskIds.has(t.id)}
              useAssigneeTodoClock={useAssigneeTodoClock}
              now={now}
              onUnlockOverdue={onUnlockOverdue}
              onReopenRequest={onReopenRequest}
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
  assigneeLabelByEmail,
  newAssignedTaskIds,
  useAssigneeTodoClock = false,
  rules,
  now,
  onUnlockOverdue,
  onReopenRequest,
}: {
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  onMove: (taskId: string, change: { status: TaskStatus; position: number }) => void;
  canMoveTask: (task: TaskRow) => boolean;
  canReviewDoneTask: (task: TaskRow) => boolean;
  onReviewDone: (taskId: string, reviewed: boolean) => void;
  categories: TaskCategory[];
  assigneeLabelByEmail: Map<string, string>;
  newAssignedTaskIds: Set<string>;
  useAssigneeTodoClock?: boolean;
  rules: TaskSlaRule[];
  now: Date;
  onUnlockOverdue: (id: string) => void;
  onReopenRequest: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const isOverdueTask = (task: TaskRow) => isTaskOverdue(task, rules, now);
  const slaDeadlineFor = (task: TaskRow): Date | null => {
    if (task.status !== "in_progress" || !task.in_progress_at) return null;
    const minutes = effectiveSlaMinutes(task, rules);
    return slaDeadline(task.in_progress_at, minutes);
  };
  // Kanban never receives backlog tasks (Backlog is a separate view), but
  // TaskStatus includes it — narrow it away so the fallback return type-checks.
  const columnOf = (task: TaskRow): BoardColumn => {
    if (task.status === "in_progress" && isOverdueTask(task)) return "overdue";
    if (task.status === "backlog") return "todo";
    if (task.status === "done" || task.status === "cancel") return "closed";
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

  const renderColumn = (column: BoardColumn) => (
    <Column
      key={column}
      column={column}
      tasks={columnTasks(column)}
      onOpen={onOpen}
      canMoveTask={canMoveTask}
      canReviewDoneTask={canReviewDoneTask}
      onReviewDone={onReviewDone}
      categoryById={categoryById}
      assigneeLabelByEmail={assigneeLabelByEmail}
      slaDeadlineFor={slaDeadlineFor}
      newAssignedTaskIds={newAssignedTaskIds}
      useAssigneeTodoClock={useAssigneeTodoClock}
      now={now}
      onUnlockOverdue={onUnlockOverdue}
      onReopenRequest={onReopenRequest}
    />
  );

  // Done/Cancel cards can't be dragged straight back to In Progress — that
  // has to go through the reason-gated Reopen action (see the Reopen button
  // on the card), same lock treatment as the Overdue column.
  function canDragTask(task: TaskRow): boolean {
    return (
      canMoveTask(task) &&
      !isOverdueTask(task) &&
      task.status !== "done" &&
      task.status !== "cancel"
    );
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
      const nextStatus = statusForDropColumn(overContainer);
      if (!nextStatus) return current;
      const movedUpdated: TaskRow = { ...moved, status: nextStatus };

      let insertIndex: number;
      if (overId.startsWith("col:")) {
        insertIndex = endIndexOfStatus(next, nextStatus);
      } else {
        const overIndex = next.findIndex((task) => task.id === overId);
        insertIndex =
          overIndex === -1 ? endIndexOfStatus(next, nextStatus) : overIndex;
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
      <div className="grid min-h-0 flex-1 grid-cols-5 gap-3 px-4 pb-6 xl:px-6">
        {KANBAN_COLUMNS.map((column) => renderColumn(column))}
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
              assigneeLabelByEmail={assigneeLabelByEmail}
              canReviewDone={false}
              onReviewDone={onReviewDone}
              onOpen={() => {}}
              slaDeadline={slaDeadlineFor(activeTask)}
              isNewAssigned={newAssignedTaskIds.has(activeTask.id)}
              useAssigneeTodoClock={useAssigneeTodoClock}
              now={now}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

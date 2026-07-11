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
import { isSlaActiveInProgress, isTaskOverdue, slaRemainingSeconds } from "@/lib/tasks/sla";
import { midpoint } from "@/lib/tasks/ordering";
import { rankTasks } from "@/lib/tasks/sorting";
import { TaskCard } from "./TaskCard";

type ManualOrderState = {
  tasksRef: TaskRow[] | null;
  order: Record<string, string[]>;
};

// The board column a draggable id currently belongs to. Column drop zones use
// the id `col:<column>`; cards use their task id.
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

function statusForDropColumn(column: BoardColumn): TaskStatus {
  return column;
}

// Kanban never receives backlog tasks (Backlog is a separate view), but
// TaskStatus includes it — narrow it away so the fallback return type-checks.
function columnOf(task: TaskRow): BoardColumn {
  if (task.status === "backlog") return "todo";
  return task.status;
}

function hasBeenInProgress(task: TaskRow): boolean {
  return (
    task.status === "in_progress" ||
    Boolean(task.in_progress_at) ||
    task.in_progress_seconds > 0
  );
}

function canDropTaskInColumn(task: TaskRow, column: BoardColumn): boolean {
  const nextStatus = statusForDropColumn(column);
  return !(nextStatus === "todo" && task.status !== "todo" && hasBeenInProgress(task));
}

function isColumnId(id: unknown): boolean {
  return String(id).startsWith("col:");
}

function applyManualOrder(
  rankedTasks: TaskRow[],
  manualOrder: Record<string, string[]>
): TaskRow[] {
  return KANBAN_COLUMNS.flatMap((column) => {
    const inColumn = rankedTasks.filter((task) => columnOf(task) === column);
    const manual = manualOrder[column];
    if (!manual?.length) return inColumn;

    const taskById = new Map(inColumn.map((task) => [task.id, task]));
    const manualSet = new Set(manual);
    const manualTasks = manual
      .map((id) => taskById.get(id))
      .filter((task): task is TaskRow => Boolean(task));

    return [
      ...manualTasks,
      ...inColumn.filter((task) => !manualSet.has(task.id)),
    ];
  });
}

function moveTaskPreview(
  items: TaskRow[],
  activeId: string,
  overId: string,
  nextStatus: TaskStatus
): TaskRow[] {
  const activeIndex = items.findIndex((task) => task.id === activeId);
  if (activeIndex === -1) return items;

  const next = [...items];
  const [moved] = next.splice(activeIndex, 1);
  const movedUpdated: TaskRow = { ...moved, status: nextStatus };

  let insertIndex: number;
  if (overId.startsWith("col:")) {
    insertIndex = endIndexOfStatus(next, nextStatus);
  } else {
    const overIndex = next.findIndex((task) => task.id === overId);
    insertIndex = overIndex === -1 ? endIndexOfStatus(next, nextStatus) : overIndex;
  }

  next.splice(insertIndex, 0, movedUpdated);
  return next;
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
  slaRemainingSeconds,
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
  slaRemainingSeconds: number | null;
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
        slaRemainingSeconds={slaRemainingSeconds}
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
  isOverdueTask,
  slaRemainingFor,
  newAssignedTaskIds,
  useAssigneeTodoClock,
  now,
  activeId,
  onUnlockOverdue,
  onReopenRequest,
}: {
  column: BoardColumn;
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  canMoveTask: (task: TaskRow) => boolean;
  canReviewDoneTask: (task: TaskRow) => boolean;
  onReviewDone: (taskId: string, reviewed: boolean) => void;
  isOverdueTask: (task: TaskRow) => boolean;
  categoryById: Map<string, TaskCategory>;
  assigneeLabelByEmail: Map<string, string>;
  slaRemainingFor: (task: TaskRow) => number | null;
  newAssignedTaskIds: Set<string>;
  useAssigneeTodoClock: boolean;
  now: Date;
  activeId: string | null;
  onUnlockOverdue: (id: string) => void;
  onReopenRequest: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column}` });
  const isTerminalColumn = column === "done" || column === "cancel";

  return (
    <section
      ref={setNodeRef}
      className={`flex min-w-0 flex-1 flex-col rounded border border-transparent bg-[#f4f5f7] p-1.5 transition-colors ${
        isOver ? "bg-[#deebff]" : ""
      }`}
    >
      <div className="flex h-9 items-center px-1">
        <span className="text-xs font-bold uppercase text-[#6b778c]">
          {BOARD_COLUMN_LABEL[column]}
        </span>
        <span className="ml-1 text-xs font-bold text-[#6b778c]">
          {tasks.length}
        </span>
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
              // Once a card is dropped into Done/Cancel it should stop being
              // draggable. While it is actively being dragged into that column,
              // keep sortable enabled so dnd-kit can finish the drop cleanly.
              canMove={
                (activeId === t.id || !isTerminalColumn) &&
                !isOverdueTask(t) &&
                canMoveTask(t)
              }
              onOpen={onOpen}
              slaRemainingSeconds={slaRemainingFor(t)}
              isOverdue={isOverdueTask(t)}
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

  // A task can only actively be overdue once (see sla.ts): resolving it
  // (Enter reason) always sends it to To Do, so the moment it's resolved it
  // structurally leaves this check too — no separate "locked" flag needed.
  const isOverdueTask = (task: TaskRow) => isTaskOverdue(task, rules, now);
  const slaRemainingFor = (task: TaskRow): number | null => {
    if (!isSlaActiveInProgress(task)) return null;
    return slaRemainingSeconds(task, rules, now);
  };

  const rankedTasks = useMemo(
    () => rankTasks(tasks, rules, now),
    [tasks, rules, now]
  );
  const [manualOrderState, setManualOrderState] = useState<ManualOrderState>({
    tasksRef: null,
    order: {},
  });
  const orderedTasks = useMemo(() => {
    const manualOrder =
      manualOrderState.tasksRef === tasks ? manualOrderState.order : {};
    return applyManualOrder(rankedTasks, manualOrder);
  }, [manualOrderState, rankedTasks, tasks]);
  // Local ordered mirror used only while dragging so the board can reflow live.
  const [dragItems, setDragItems] = useState<TaskRow[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const items = dragItems ?? orderedTasks;

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
      isOverdueTask={isOverdueTask}
      categoryById={categoryById}
      assigneeLabelByEmail={assigneeLabelByEmail}
      slaRemainingFor={slaRemainingFor}
      newAssignedTaskIds={newAssignedTaskIds}
      useAssigneeTodoClock={useAssigneeTodoClock}
      now={now}
      activeId={activeId}
      onUnlockOverdue={onUnlockOverdue}
      onReopenRequest={onReopenRequest}
    />
  );

  // Done/Cancel cards go through the reason-gated Reopen action. Overdue
  // cards are locked (must "Enter reason") until resolved, which sends them
  // to To Do — so a task can never be dragged while overdue.
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
    const task = orderedTasks.find((item) => item.id === id);
    if (!task || !canDragTask(task)) return;
    setDragItems(orderedTasks);
    setActiveId(id);
  }

  // Live cross-column move: when the dragged card hovers a different column,
  // splice it into that column immediately so the board reflows under the cursor.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const original = tasks.find((task) => task.id === activeId);
    if (!original || !canDragTask(original)) return;

    setDragItems((prev) => {
      const current = prev ?? orderedTasks;
      const activeContainer = findContainer(activeId, current, columnOf);
      const overContainer = findContainer(overId, current, columnOf);
      if (!activeContainer || !overContainer || activeContainer === overContainer) {
        return current;
      }
      if (!canDropTaskInColumn(original, overContainer)) return current;

      const nextStatus = statusForDropColumn(overContainer);
      return moveTaskPreview(current, activeId, overId, nextStatus);
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

    const overContainer = findContainer(overId, items, columnOf);
    if (!overContainer) return;

    const originalColumn = columnOf(original);
    if (overContainer === originalColumn) {
      if (overId.startsWith("col:")) return;

      const columnItems = items.filter((task) => columnOf(task) === originalColumn);
      const activeIndex = columnItems.findIndex((task) => task.id === activeId);
      const overIndex = columnItems.findIndex((task) => task.id === overId);
      if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
        const nextColumnItems = arrayMove(columnItems, activeIndex, overIndex);
        setManualOrderState((current) => ({
          tasksRef: tasks,
          order: {
            ...(current.tasksRef === tasks ? current.order : {}),
            [originalColumn]: nextColumnItems.map((task) => task.id),
          },
        }));
      }
      return;
    }

    const nextStatus = statusForDropColumn(overContainer);
    if (!canDropTaskInColumn(original, overContainer)) return;

    const working =
      original.status === nextStatus
        ? items
        : moveTaskPreview(items, activeId, overId, nextStatus);

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
              slaRemainingSeconds={slaRemainingFor(activeTask)}
              isOverdue={isOverdueTask(activeTask)}
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

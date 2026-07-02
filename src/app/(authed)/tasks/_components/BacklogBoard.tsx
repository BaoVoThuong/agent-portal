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
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import type { NewTaskPayload } from "./NewTaskDialog";
import { TaskSelect } from "./TaskSelect";
import { LIST_COL, TaskRowItem } from "./TaskRowItem";

export function BacklogBoard({
  tasks,
  assignees,
  agents,
  agentMembersByAgent,
  categories,
  onOpen,
  onPatch,
  onAssigneeChange,
  onReorder,
  onCreate,
}: {
  tasks: TaskRow[];
  assignees: TaskAssignee[];
  agents: TaskAgent[];
  agentMembersByAgent: Record<string, string[]>;
  categories: TaskCategory[];
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onAssigneeChange: (id: string, email: string, assigned: boolean) => void;
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
        <BacklogHeader />

        {backlog.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm font-semibold text-[#6b778c]">
            Backlog is empty. Add the first task below.
          </div>
        ) : (
          <DndContext
            id="backlog-board"
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
                    agentMembersByAgent={agentMembersByAgent}
                    onOpen={onOpen}
                    onPatch={onPatch}
                    onAssigneeChange={onAssigneeChange}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        <InlineCreateRow
          agents={agents}
          categories={categories}
          onCreate={onCreate}
        />
      </div>
    </div>
  );
}

function BacklogHeader() {
  return (
    <div className="flex items-center gap-3 border-b border-[#dfe1e6] bg-[#fafbfc] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
      <span className="w-4 shrink-0" aria-hidden="true" />
      <span className={`${LIST_COL.key} shrink-0 truncate`}>Key</span>
      <span className="min-w-0 flex-1 truncate">Summary</span>
      <span className={`hidden ${LIST_COL.category} shrink-0 truncate sm:block`}>
        Category
      </span>
      <span className={`${LIST_COL.created} shrink-0 truncate`}>Created</span>
      <span className={`flex ${LIST_COL.priority} shrink-0 justify-center`}>
        Priority
      </span>
      <span className={`${LIST_COL.status} shrink-0 truncate`}>Status</span>
      <span className={`flex ${LIST_COL.review} shrink-0 justify-center`}>
        QC
      </span>
      <span className={`flex ${LIST_COL.assignee} shrink-0 justify-center`}>
        Assignee
      </span>
    </div>
  );
}

function BacklogSortableRow({
  task,
  category,
  assignees,
  agentMembersByAgent,
  onOpen,
  onPatch,
  onAssigneeChange,
}: {
  task: TaskRow;
  category: TaskCategory | null;
  assignees: TaskAssignee[];
  agentMembersByAgent: Record<string, string[]>;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onAssigneeChange: (id: string, email: string, assigned: boolean) => void;
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
        agentMembersByAgent={agentMembersByAgent}
        canEdit
        canAssign
        canReviewDone={false}
        onOpen={onOpen}
        onPatch={onPatch}
        onReviewDone={() => {}}
        onAssigneeChange={onAssigneeChange}
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
  agents,
  categories,
  onCreate,
}: {
  agents: TaskAgent[];
  categories: TaskCategory[];
  onCreate: (payload: NewTaskPayload) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const agentOptions = agents.map((agent) => ({
    value: agent.email,
    label: agent.name ?? agent.email,
  }));
  const canSubmit = Boolean(title.trim() && categoryId && agentEmail && !saving);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || !categoryId || !agentEmail || saving) return;
    setSaving(true);
    try {
      await onCreate({
        title: trimmed,
        description: "",
        priority: "medium",
        category_id: categoryId,
        agent_email: agentEmail,
      });
      setTitle("");
    } catch {
      // TaskBoardClient owns the visible error toast.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid items-center gap-2 border-t border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5 md:grid-cols-[minmax(14rem,1fr)_13rem_13rem_auto]">
      <div className="flex min-w-0 items-center gap-2">
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
          disabled={saving}
          placeholder="Task title"
          className="min-w-0 flex-1 bg-transparent text-sm text-[#172b4d] outline-none placeholder:text-[#7a869a] disabled:opacity-60"
        />
      </div>
      <TaskSelect
        label="Category"
        value={categoryId}
        options={categoryOptions}
        placeholder="Select category"
        disabled={saving}
        onChange={setCategoryId}
        buttonClassName="!h-9 !border-[#dfe1e6] !bg-white !text-sm !shadow-none"
        menuClassName="min-w-full"
      />
      <TaskSelect
        label="Agent"
        value={agentEmail}
        options={agentOptions}
        placeholder="Select agent"
        disabled={saving}
        onChange={setAgentEmail}
        buttonClassName="!h-9 !border-[#dfe1e6] !bg-white !text-sm !shadow-none"
        menuClassName="min-w-full"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="inline-flex h-9 items-center justify-center rounded bg-[#0c66e4] px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Add
      </button>
    </div>
  );
}

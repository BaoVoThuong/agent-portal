"use client";

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, UserPlus } from "lucide-react";
import {
  STATUS_LABEL,
  TASK_STATUSES,
  type TaskCategory,
  type TaskRow,
  type TaskStatus,
} from "@/lib/tasks/types";
import { taskKey } from "@/lib/tasks/sorting";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { DueBadge, Initials, PriorityIcon, PRIORITY_META } from "./board-ui";
import { useAnchoredMenu } from "./use-anchored-menu";

// Shared column widths so the List header and the rows line up exactly.
export const LIST_COL = {
  key: "w-20",
  category: "w-52",
  due: "w-24",
  created: "w-24",
  priority: "w-16",
  status: "w-28",
  assignee: "w-12",
};

const STATUS_PILL: Record<TaskStatus, { bg: string; fg: string }> = {
  backlog: { bg: "#dfe1e6", fg: "#42526e" },
  todo: { bg: "#dfe1e6", fg: "#42526e" },
  in_progress: { bg: "#deebff", fg: "#0055cc" },
  waiting: { bg: "#fff0b3", fg: "#7f5f01" },
  done: { bg: "#e3fcef", fg: "#006644" },
};

export function TaskRowItem({
  task,
  category,
  assignees,
  canEdit,
  canAssign,
  onOpen,
  onPatch,
  dragHandle,
}: {
  task: TaskRow;
  category: TaskCategory | null;
  assignees: TaskAssignee[];
  canEdit: boolean;
  canAssign: boolean;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  dragHandle?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 bg-white px-4 py-2.5 transition hover:bg-[#f7f8f9]">
      {dragHandle}
      <span
        className={`${LIST_COL.key} shrink-0 truncate font-mono text-xs font-bold text-[#97a0af]`}
      >
        {taskKey(task.id)}
      </span>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[#172b4d] hover:text-[#0c66e4]"
        title={task.title}
      >
        {task.title}
      </button>

      <span className={`hidden ${LIST_COL.category} shrink-0 truncate sm:block`}>
        {category ? (
          <span
            className="rounded bg-[#ebecf0] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#42526e]"
            title={category.name}
          >
            {category.name}
          </span>
        ) : null}
      </span>

      <span className={`${LIST_COL.due} shrink-0`}>
        <DueBadge due={task.due_date} />
      </span>

      <span className={`${LIST_COL.created} shrink-0 text-[11px] font-medium text-[#6b778c]`}>
        {task.created_at.slice(0, 10)}
      </span>

      <span
        className={`flex ${LIST_COL.priority} shrink-0 justify-center`}
        title={`${PRIORITY_META[task.priority].label} priority`}
      >
        <PriorityIcon priority={task.priority} className="h-4 w-4" />
      </span>

      <StatusPill
        status={task.status}
        assigned={task.assignee_email !== null}
        canEdit={canEdit}
        onChange={(status) => onPatch(task.id, { status })}
      />

      <span className={`flex ${LIST_COL.assignee} shrink-0 justify-center`}>
        <AssigneeMenu
          email={task.assignee_email}
          assignees={assignees}
          canAssign={canAssign}
          onChange={(email) =>
            onPatch(
              task.id,
              email
                ? {
                    assignee_email: email,
                    status: task.status === "backlog" ? "todo" : task.status,
                  }
                : { assignee_email: null, status: "backlog" }
            )
          }
        />
      </span>
    </div>
  );
}

function StatusPill({
  status,
  assigned,
  canEdit,
  onChange,
}: {
  status: TaskStatus;
  assigned: boolean;
  canEdit: boolean;
  onChange: (status: TaskStatus) => void;
}) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const meta = STATUS_PILL[status];

  // Backlog membership is governed by assignment (the avatar menu), not this
  // dropdown: assigning moves a task to 'todo', unassigning sends it to backlog.
  // So we never offer 'backlog' here, and we lock the pill while a task is
  // unassigned — that avoids emitting a patch the server rejects (the invariant
  // "non-backlog task must have an assignee" / "unassign before backlog").
  const interactive = canEdit && assigned;
  const options = TASK_STATUSES.filter((s) => s !== "backlog");

  const pill = (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: meta.bg, color: meta.fg }}
    >
      {STATUS_LABEL[status]}
      {interactive ? <ChevronDown className="h-3 w-3" /> : null}
    </span>
  );

  if (!interactive) {
    return (
      <span
        className={`${LIST_COL.status} shrink-0`}
        title={
          canEdit && !assigned
            ? "Gán người (avatar) để chuyển khỏi backlog"
            : undefined
        }
      >
        {pill}
      </span>
    );
  }

  return (
    <span className={`${LIST_COL.status} shrink-0`}>
      <button ref={triggerRef} type="button" onClick={toggle} aria-expanded={isOpen}>
        {pill}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="z-[100] overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              {options.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={s === status}
                  onClick={() => {
                    onChange(s);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-sm transition ${
                    s === status
                      ? "bg-[#e9f2ff] text-[#0c66e4]"
                      : "text-[#172b4d] hover:bg-[#f4f5f7]"
                  }`}
                >
                  {STATUS_LABEL[s]}
                  {s === status ? <Check className="h-4 w-4 text-[#0c66e4]" /> : null}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function AssigneeMenu({
  email,
  assignees,
  canAssign,
  onChange,
}: {
  email: string | null;
  assignees: TaskAssignee[];
  canAssign: boolean;
  onChange: (email: string | null) => void;
}) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();

  const face = email ? (
    <Initials email={email} />
  ) : (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[#8590a2] text-[#8590a2]">
      <UserPlus className="h-3.5 w-3.5" />
    </span>
  );

  if (!canAssign) {
    return (
      <span className="shrink-0" title={email ?? "Unassigned"}>
        {face}
      </span>
    );
  }

  return (
    <span className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        title={email ?? "Unassigned"}
        className="rounded-full transition hover:opacity-80"
      >
        {face}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="z-[100] max-h-72 min-w-[14rem] overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              <button
                type="button"
                role="option"
                aria-selected={!email}
                onClick={() => {
                  onChange(null);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition ${
                  !email ? "bg-[#e9f2ff] text-[#0c66e4]" : "text-[#172b4d] hover:bg-[#f4f5f7]"
                }`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[#8590a2] text-[#8590a2]">
                  <UserPlus className="h-3.5 w-3.5" />
                </span>
                Unassigned
              </button>
              {assignees.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  role="option"
                  aria-selected={a.email === email}
                  onClick={() => {
                    onChange(a.email);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition ${
                    a.email === email
                      ? "bg-[#e9f2ff] text-[#0c66e4]"
                      : "text-[#172b4d] hover:bg-[#f4f5f7]"
                  }`}
                >
                  <Initials email={a.email} />
                  <span className="min-w-0 flex-1 truncate">{a.name ?? a.email}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

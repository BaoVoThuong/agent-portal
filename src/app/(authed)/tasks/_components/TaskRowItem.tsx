"use client";

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import {
  STATUS_LABEL,
  TASK_STATUSES,
  type TaskCategory,
  type TaskRow,
  type TaskStatus,
} from "@/lib/tasks/types";
import { taskKey } from "@/lib/tasks/sorting";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { AvatarStack, PriorityIcon, PRIORITY_META } from "./board-ui";
import { TaskAssigneePicker } from "./TaskAssigneePicker";
import { useAnchoredMenu } from "./use-anchored-menu";

// Shared column widths so the List header and the rows line up exactly.
export const LIST_COL = {
  key: "w-20",
  category: "w-52",
  created: "w-24",
  priority: "w-16",
  status: "w-28",
  assignee: "w-20",
};

const STATUS_PILL: Record<TaskStatus, { bg: string; fg: string }> = {
  backlog: { bg: "#dfe1e6", fg: "#42526e" },
  todo: { bg: "#dfe1e6", fg: "#42526e" },
  in_progress: { bg: "#deebff", fg: "#0055cc" },
  waiting: { bg: "#fff0b3", fg: "#7f5f01" },
  done: { bg: "#e3fcef", fg: "#006644" },
  cancel: { bg: "#ffebe6", fg: "#bf2600" },
};

export function TaskRowItem({
  task,
  category,
  assignees,
  agentMembersByAgent,
  canEdit,
  canAssign,
  onOpen,
  onPatch,
  onAssigneeChange,
  dragHandle,
  openOnDoubleClick = false,
}: {
  task: TaskRow;
  category: TaskCategory | null;
  assignees: TaskAssignee[];
  agentMembersByAgent: Record<string, string[]>;
  canEdit: boolean;
  canAssign: boolean;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onAssigneeChange: (id: string, email: string, assigned: boolean) => void;
  dragHandle?: ReactNode;
  openOnDoubleClick?: boolean;
}) {
  const assigneeLabelByEmail = new Map(
    assignees.map((assignee) => [
      assignee.email,
      assignee.name?.trim() || assignee.email,
    ])
  );

  return (
    <div
      onDoubleClick={() => {
        if (openOnDoubleClick) onOpen(task.id);
      }}
      className="flex items-center gap-3 bg-white px-4 py-2.5 transition hover:bg-[#f7f8f9]"
    >
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
        assigned={task.assignees.length > 0}
        canEdit={canEdit}
        onChange={(status) => onPatch(task.id, { status })}
      />

      <span className={`flex ${LIST_COL.assignee} shrink-0 justify-center`}>
        <AssigneeMenu
          emails={task.assignees}
          assignees={assignees}
          agentEmail={task.agent_email}
          agentMembersByAgent={agentMembersByAgent}
          labelByEmail={assigneeLabelByEmail}
          canAssign={canAssign}
          onToggle={(email, assigned) => onAssigneeChange(task.id, email, assigned)}
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
  emails,
  assignees,
  agentEmail,
  agentMembersByAgent,
  labelByEmail,
  canAssign,
  onToggle,
}: {
  emails: string[];
  assignees: TaskAssignee[];
  agentEmail: string | null;
  agentMembersByAgent: Record<string, string[]>;
  labelByEmail: Map<string, string>;
  canAssign: boolean;
  onToggle: (email: string, assigned: boolean) => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle } = useAnchoredMenu();
  const selectedLabel =
    emails.length > 0
      ? emails.map((email) => labelByEmail.get(email) ?? email).join(", ")
      : "Unassigned";
  const face = <AvatarStack emails={emails} labelByEmail={labelByEmail} />;

  if (!canAssign) {
    return (
      <span className="shrink-0" title={selectedLabel}>
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
        title={selectedLabel}
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
              className="z-[100] min-w-[18rem] rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              <TaskAssigneePicker
                assignees={assignees}
                selectedEmails={emails}
                agentEmail={agentEmail}
                agentMembersByAgent={agentMembersByAgent}
                onToggle={onToggle}
                listClassName="max-h-48"
                autoFocus
              />
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

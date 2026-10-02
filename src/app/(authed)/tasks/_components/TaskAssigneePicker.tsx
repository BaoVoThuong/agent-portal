"use client";

import { useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, UserPlus } from "lucide-react";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { formatEmailAsName } from "@/lib/tasks/people";
import { normalizeOptionSearchText } from "@/lib/ui/option-search";
import { AvatarStack, Initials } from "./board-ui";
import { useAnchoredMenu } from "./use-anchored-menu";

// Shared field chrome for single- and multi-assignee controls. Enrollment
// reuses this exact class so the same person-valued field has one visual
// contract across the application.
export const TASK_ASSIGNEE_BUTTON_CLASS =
  "flex min-h-10 w-full items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-left text-sm font-semibold text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4]";

export function TaskAssigneeDropdown({
  assignees,
  selectedEmails,
  agentEmail = null,
  agentMembersByAgent = {},
  onToggle,
  buttonClassName = "",
  emptyLabel = "Unassigned",
  pluralLabel = "assignees",
  searchPlaceholder,
  listLabel,
}: {
  assignees: TaskAssignee[];
  selectedEmails: string[];
  agentEmail?: string | null;
  agentMembersByAgent?: Record<string, string[]>;
  onToggle: (email: string, assigned: boolean) => void;
  buttonClassName?: string;
  /** Nhãn khi chưa chọn ai — Lead Collaborators dùng chung control này. */
  emptyLabel?: string;
  /** "3 assignees" / "3 collaborators". */
  pluralLabel?: string;
  searchPlaceholder?: string;
  listLabel?: string;
}) {
  const {
    isOpen,
    toggle,
    triggerRef,
    menuRef,
    menuStyle,
    closeMenuForTab,
  } = useAnchoredMenu();
  const labelByEmail = useMemo(
    () =>
      new Map(
        assignees.map((assignee) => [
          assignee.email,
          assignee.name?.trim() || formatEmailAsName(assignee.email),
        ])
      ),
    [assignees]
  );
  const selectedLabels = selectedEmails.map(
    (email) => labelByEmail.get(email) ?? formatEmailAsName(email)
  );
  const isUnassigned = selectedLabels.length === 0;
  const summary =
    isUnassigned
      ? emptyLabel
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} ${pluralLabel}`;

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={`${TASK_ASSIGNEE_BUTTON_CLASS} ${buttonClassName}`}
      >
        <AvatarStack emails={selectedEmails} labelByEmail={labelByEmail} max={3} />
        <span
          className={`min-w-0 flex-1 truncate ${
            isUnassigned ? "font-normal text-[#97a0af]" : "text-[#172b4d]"
          }`}
        >
          {summary}
        </span>
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="z-[120] min-w-[18rem] rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              <TaskAssigneePicker
                assignees={assignees}
                selectedEmails={selectedEmails}
                agentEmail={agentEmail}
                agentMembersByAgent={agentMembersByAgent}
                onToggle={onToggle}
                listClassName="max-h-56"
                autoFocus
                onTabExit={closeMenuForTab}
                emptyLabel={emptyLabel}
                searchPlaceholder={searchPlaceholder}
                listLabel={listLabel}
              />
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function TaskAssigneePicker({
  assignees,
  selectedEmails,
  onToggle,
  className = "",
  listClassName = "max-h-52",
  autoFocus = false,
  onTabExit,
  emptyLabel = "Unassigned",
  searchPlaceholder = "Search CS",
  listLabel = "Assignees",
}: {
  assignees: TaskAssignee[];
  selectedEmails: string[];
  agentEmail?: string | null;
  agentMembersByAgent?: Record<string, string[]>;
  onToggle: (email: string, assigned: boolean) => void;
  className?: string;
  listClassName?: string;
  autoFocus?: boolean;
  onTabExit?: () => void;
  emptyLabel?: string;
  searchPlaceholder?: string;
  listLabel?: string;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedEmails), [selectedEmails]);
  const peopleByEmail = useMemo(
    () => new Map(assignees.map((assignee) => [assignee.email, assignee])),
    [assignees]
  );
  const selectedPeople = selectedEmails.map(
    (email) => peopleByEmail.get(email) ?? { email, name: null }
  );
  const normalizedQuery = normalizeOptionSearchText(query);
  const people = useMemo(() => {
    return [...assignees]
      .sort((a, b) => {
        const aSelected = selected.has(a.email);
        const bSelected = selected.has(b.email);
        if (aSelected !== bSelected) return aSelected ? -1 : 1;
        return (a.name ?? a.email).localeCompare(b.name ?? b.email);
      })
      .filter((assignee) => {
        if (selected.has(assignee.email)) return false;
        if (!normalizedQuery) return true;
        const label = normalizeOptionSearchText(
          `${assignee.name ?? ""} ${assignee.email}`
        );
        return label.includes(normalizedQuery);
      });
  }, [normalizedQuery, assignees, selected]);
  const emptyMessage = "No matches.";

  return (
    <div className={`overflow-hidden rounded-lg border-2 border-[#dfe1e6] bg-white ${className}`}>
      <div className="border-b border-[#ebecf0] p-1">
        {selectedPeople.length > 0 ? (
          <div className="space-y-1">
            {selectedPeople.map((assignee) => {
              const label =
                assignee.name?.trim() || formatEmailAsName(assignee.email);
              return (
                <button
                  key={assignee.email}
                  type="button"
                  onClick={() => onToggle(assignee.email, false)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition bg-[#e9f2ff] text-[#0c66e4] hover:bg-[#deebff]"
                >
                  <Initials email={assignee.email} label={label} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
                  <Check className="h-4 w-4 shrink-0" />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-2 py-2 text-sm font-semibold text-[#6b778c]">
            {emptyLabel}
          </div>
        )}
      </div>

      <label className="flex h-9 items-center gap-2 border-b border-[#ebecf0] px-2">
        <Search className="h-4 w-4 shrink-0 text-[#7a869a]" />
        <input
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Tab") onTabExit?.();
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          placeholder={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[#172b4d] outline-none placeholder:text-[#97a0af]"
        />
      </label>

      <div
        id={listboxId}
        role="listbox"
        aria-label={listLabel}
        className={`overflow-auto p-1 ${listClassName}`}
      >
        {people.map((assignee) => {
          const checked = selected.has(assignee.email);
          const label =
            assignee.name?.trim() || formatEmailAsName(assignee.email);
          return (
            <button
              key={assignee.email}
              type="button"
              aria-pressed={checked}
              onClick={() => onToggle(assignee.email, !checked)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
                checked
                  ? "bg-[#e9f2ff] text-[#0c66e4]"
                  : "text-[#172b4d] hover:bg-[#f4f5f7]"
              }`}
            >
              <Initials email={assignee.email} label={label} />
              <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  checked
                    ? "border-[#0c66e4] bg-[#0c66e4] text-white"
                    : "border-[#c1c7d0]"
                }`}
              >
                {checked ? <Check className="h-3 w-3" /> : null}
              </span>
            </button>
          );
        })}

        {people.length === 0 ? (
          <div className="px-2 py-2 text-sm font-medium text-[#6b778c]">
            {emptyMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ô người trong bảng (Task List cột Assignees, Lead cột Collaborators): mỗi
 * người một dòng avatar + tên, trống thì là nút "Assign" viền đứt; bấm mở
 * TaskAssigneePicker.
 */
export function TaskAssigneeMenu({
  emails,
  assignees,
  agentEmail = null,
  agentMembersByAgent = {},
  labelByEmail,
  canAssign,
  onToggle,
  emptyLabel = "Unassigned",
  emptyActionLabel = "Assign",
  searchPlaceholder,
  listLabel,
}: {
  emails: string[];
  assignees: TaskAssignee[];
  agentEmail?: string | null;
  agentMembersByAgent?: Record<string, string[]>;
  labelByEmail: ReadonlyMap<string, string>;
  canAssign: boolean;
  onToggle: (email: string, assigned: boolean) => void;
  emptyLabel?: string;
  emptyActionLabel?: string;
  searchPlaceholder?: string;
  listLabel?: string;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, closeMenuForTab } =
    useAnchoredMenu();
  const selectedLabel =
    emails.length > 0
      ? emails.map((email) => labelByEmail.get(email) ?? formatEmailAsName(email)).join(", ")
      : emptyLabel;
  const assignedPeople = emails.map((email) => ({
    email,
    label: labelByEmail.get(email) ?? formatEmailAsName(email),
  }));
  const isUnassigned = emails.length === 0;
  const labelClassName = emails.length > 0 ? "text-[#42526e]" : "text-[#97a0af]";

  if (!canAssign) {
    return (
      <span
        className={`flex w-full min-w-0 flex-col items-start gap-0.5 whitespace-normal text-left text-xs font-semibold leading-tight ${labelClassName}`}
        title={selectedLabel}
      >
        {assignedPeople.length > 0 ? (
          assignedPeople.map((person) => (
            <span
              key={person.email}
              className="flex min-w-0 items-center gap-1.5 whitespace-nowrap"
            >
              <Initials email={person.email} label={person.label} />
              <span>{person.label}</span>
            </span>
          ))
        ) : (
          <span className="text-[#97a0af]">{emptyLabel}</span>
        )}
      </span>
    );
  }

  return (
    <span className="block min-w-0 whitespace-normal">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        title={selectedLabel}
        className={
          isUnassigned
            ? "inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] bg-white px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#deebff]"
            : `flex w-full min-w-0 flex-col items-start gap-0.5 whitespace-normal rounded text-left text-xs font-semibold leading-tight transition hover:text-[#0c66e4] ${labelClassName}`
        }
      >
        {isUnassigned ? (
          <>
            <UserPlus className="h-3 w-3 shrink-0" />
            <span>{emptyActionLabel}</span>
          </>
        ) : (
          assignedPeople.map((person) => (
            <span
              key={person.email}
              className="flex min-w-0 items-center gap-1.5 whitespace-nowrap"
            >
              <Initials email={person.email} label={person.label} />
              <span>{person.label}</span>
            </span>
          ))
        )}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
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
                onTabExit={closeMenuForTab}
                emptyLabel={emptyLabel}
                searchPlaceholder={searchPlaceholder}
                listLabel={listLabel}
              />
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

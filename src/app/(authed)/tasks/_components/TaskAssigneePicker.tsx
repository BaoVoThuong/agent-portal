"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search } from "lucide-react";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { AvatarStack, Initials } from "./board-ui";
import { useAnchoredMenu } from "./use-anchored-menu";

export function TaskAssigneeDropdown({
  assignees,
  selectedEmails,
  agentEmail = null,
  agentMembersByAgent = {},
  onToggle,
  buttonClassName = "",
}: {
  assignees: TaskAssignee[];
  selectedEmails: string[];
  agentEmail?: string | null;
  agentMembersByAgent?: Record<string, string[]>;
  onToggle: (email: string, assigned: boolean) => void;
  buttonClassName?: string;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle } = useAnchoredMenu();
  const labelByEmail = useMemo(
    () =>
      new Map(
        assignees.map((assignee) => [
          assignee.email,
          assignee.name?.trim() || assignee.email,
        ])
      ),
    [assignees]
  );
  const selectedLabels = selectedEmails.map(
    (email) => labelByEmail.get(email) ?? email
  );
  const isUnassigned = selectedLabels.length === 0;
  const summary =
    isUnassigned
      ? "Unassigned"
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} assignees`;

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className={`flex min-h-10 w-full items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-left text-sm font-semibold text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] ${buttonClassName}`}
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
}: {
  assignees: TaskAssignee[];
  selectedEmails: string[];
  agentEmail?: string | null;
  agentMembersByAgent?: Record<string, string[]>;
  onToggle: (email: string, assigned: boolean) => void;
  className?: string;
  listClassName?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedEmails), [selectedEmails]);
  const peopleByEmail = useMemo(
    () => new Map(assignees.map((assignee) => [assignee.email, assignee])),
    [assignees]
  );
  const selectedPeople = selectedEmails.map(
    (email) => peopleByEmail.get(email) ?? { email, name: null }
  );
  const normalizedQuery = query.trim().toLowerCase();
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
        const label = `${assignee.name ?? ""} ${assignee.email}`.toLowerCase();
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
              const label = assignee.name?.trim() || assignee.email;
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
            Unassigned
          </div>
        )}
      </div>

      <label className="flex h-9 items-center gap-2 border-b border-[#ebecf0] px-2">
        <Search className="h-4 w-4 shrink-0 text-[#7a869a]" />
        <input
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search CS"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[#172b4d] outline-none placeholder:text-[#97a0af]"
        />
      </label>

      <div className={`overflow-auto p-1 ${listClassName}`}>
        {people.map((assignee) => {
          const checked = selected.has(assignee.email);
          const label = assignee.name?.trim() || assignee.email;
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

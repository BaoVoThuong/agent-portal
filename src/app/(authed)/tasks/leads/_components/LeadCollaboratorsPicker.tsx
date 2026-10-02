"use client";

import { useMemo } from "react";
import { formatEmailAsName } from "@/lib/tasks/people";
import { AvatarStack } from "../../_components/board-ui";
import {
  TaskAssigneeDropdown,
  TaskAssigneeMenu,
} from "../../_components/TaskAssigneePicker";

export type LeadCollaboratorPerson = { email: string; name: string | null };

// Collaborators là một trường người nhiều giá trị, nên dùng đúng control
// Assignees của Task (avatar + tên, ô tìm, tick nhiều người) — chỉ đổi nhãn.
const COLLABORATOR_LABELS = {
  emptyLabel: "No collaborators",
  pluralLabel: "collaborators",
  searchPlaceholder: "Search people",
  listLabel: "Collaborators",
} as const;

const READ_ONLY_FIELD_CLASS =
  "flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-sm font-medium text-[#172b4d]";

function toggleCollaborator(
  emails: readonly string[],
  email: string,
  assigned: boolean,
): string[] {
  const normalized = email.trim().toLowerCase();
  const rest = emails.filter((current) => current.trim().toLowerCase() !== normalized);
  return assigned ? [...rest, normalized] : rest;
}

function useLabelByEmail(people: readonly LeadCollaboratorPerson[]) {
  return useMemo(
    () =>
      new Map(
        people.map((person) => [
          person.email,
          person.name?.trim() || formatEmailAsName(person.email),
        ]),
      ),
    [people],
  );
}

/** Create dialog: chọn trước khi lead tồn tại, nên chỉ đổi state của form. */
export function LeadCollaboratorsPicker({
  emails,
  people,
  onChange,
  buttonClassName = "",
}: {
  emails: string[];
  people: LeadCollaboratorPerson[];
  onChange: (emails: string[]) => void;
  buttonClassName?: string;
}) {
  return (
    <TaskAssigneeDropdown
      assignees={people}
      selectedEmails={emails}
      onToggle={(email, assigned) => onChange(toggleCollaborator(emails, email, assigned))}
      buttonClassName={buttonClassName}
      {...COLLABORATOR_LABELS}
    />
  );
}

/**
 * Drawer và bảng: mỗi cú tick lưu luôn, như Assignees của Task. Không cần bản
 * nháp + nút Save nữa: `patchLead` trong LeadsClient đã hiện ngay, xếp hàng các
 * lượt PATCH theo từng lead, và tự trả lại + báo lỗi khi một lượt hỏng — nên
 * cú tick thứ hai luôn tính từ danh sách đã có cú tick thứ nhất.
 */
export function LeadCollaboratorsEditor({
  emails,
  people,
  canEdit,
  onSave,
  compact = false,
}: {
  emails: string[];
  people: LeadCollaboratorPerson[];
  canEdit: boolean;
  onSave: (emails: string[]) => Promise<void>;
  /** Ô trong bảng: mỗi người một dòng, giống cột Assignees của Task List. */
  compact?: boolean;
}) {
  const labelByEmail = useLabelByEmail(people);
  const toggle = (email: string, assigned: boolean) => {
    // Lỗi đã được LeadsClient/drawer hiện ra; ở đây chỉ chặn unhandled rejection.
    void onSave(toggleCollaborator(emails, email, assigned)).catch(() => undefined);
  };

  if (compact) {
    return (
      <TaskAssigneeMenu
        emails={emails}
        assignees={people}
        labelByEmail={labelByEmail}
        canAssign={canEdit}
        onToggle={toggle}
        emptyActionLabel="Add"
        {...COLLABORATOR_LABELS}
      />
    );
  }

  if (!canEdit) {
    return (
      <div className={READ_ONLY_FIELD_CLASS}>
        <AvatarStack emails={emails} labelByEmail={labelByEmail} />
        <span
          className={`min-w-0 truncate ${emails.length === 0 ? "text-[#97a0af]" : ""}`}
        >
          {emails.length > 0
            ? emails
                .map((email) => labelByEmail.get(email) ?? formatEmailAsName(email))
                .join(", ")
            : COLLABORATOR_LABELS.emptyLabel}
        </span>
      </div>
    );
  }

  return (
    <TaskAssigneeDropdown
      assignees={people}
      selectedEmails={emails}
      onToggle={toggle}
      {...COLLABORATOR_LABELS}
    />
  );
}

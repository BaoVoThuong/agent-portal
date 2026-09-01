"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LeadInteraction,
  LeadInteractionType,
  LeadRow,
  LeadStatus,
  type LeadProduct,
} from "@/lib/leads/types";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { EditableCustomCell } from "../../_shared/EditableCustomCell";
import { InteractionLog } from "./InteractionLog";
import { LeadChoiceField } from "./LeadChoiceField";
import { leadDisplayKey } from "@/lib/leads/display";
import { leadIsInScope } from "@/lib/leads/capabilities";
import { personLabel } from "@/lib/tasks/people";
import { taskCategoryBadgePalette } from "@/lib/tasks/category-colors";
import { AvatarStack } from "../../tasks/_components/board-ui";
import { useBodyScrollLock } from "../../_shared/useBodyScrollLock";
import { ProductMenu } from "./LeadTable";

// These mirror the compact field primitives in TaskDetailDrawer. Keeping them
// local lets Lead retain its domain-specific data while sharing the same UI
// rhythm: labels and compact editable controls.
const LABEL_CLASS = "text-xs font-bold uppercase tracking-wide text-[#6b778c]";
const INPUT_CLASS =
  "w-full rounded border-2 border-[#dfe1e6] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:border-[#dfe1e6] disabled:bg-[#f4f5f7] disabled:text-[#6b778c]";
const COMPACT_DETAIL_FIELD_CLASS = "block shrink-0 space-y-1";
const COMPACT_DETAIL_INPUT_CLASS = `${INPUT_CLASS} h-9 !px-2 !py-1.5 font-semibold`;
const RAIL_SELECT_BUTTON_CLASS =
  "!h-9 !w-full !justify-between !rounded-lg !border-2 !border-[#dfe1e6] !bg-white !px-2 !text-sm !font-semibold !text-[#172b4d] !shadow-none hover:!border-[#c1c7d0] hover:!bg-white disabled:!cursor-not-allowed disabled:!bg-[#f4f5f7] disabled:!text-[#6b778c]";
// Same control chrome as TaskAssigneeDropdown. Lead remains single-assignee,
// but its empty state should use the task's dashed user-plus avatar rather
// than looking like an ordinary empty select.
const ASSIGNEE_SELECT_BUTTON_CLASS =
  "!min-h-10 !h-auto !w-full !justify-start !gap-2 !rounded-lg !border-2 !border-[#dfe1e6] !bg-white !px-2 !py-1.5 !text-left !text-sm !font-semibold !text-[#172b4d] !shadow-none hover:!border-[#c1c7d0] hover:!bg-white focus:!border-[#0c66e4] disabled:!cursor-not-allowed disabled:!border-[#dfe1e6] disabled:!bg-[#f4f5f7] disabled:!text-[#6b778c]";
const READ_ONLY_ASSIGNEE_FIELD_CLASS =
  "flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-sm font-medium text-[#172b4d]";
const READ_ONLY_METADATA_FIELD_CLASS =
  "flex min-h-9 items-center rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-2 text-sm font-medium text-[#172b4d]";
const REQUIRED_MARK = <span className="text-[#bf2600]"> *</span>;


function displayDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}


function RailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      {children}
    </div>
  );
}

function LeadDetailTabButton({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      aria-current="page"
      className="group -mb-px inline-flex items-center gap-1.5 border-b-2 border-[#0c66e4] px-1 pb-2 text-sm font-semibold text-[#0c66e4]"
    >
      {label}
      <span className="rounded-full bg-[#e9f2ff] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[#0c66e4]">
        {count}
      </span>
    </button>
  );
}

function statusBadgeStyle(status: LeadStatus) {
  const palette = taskCategoryBadgePalette({
    id: status.id,
    name: status.label,
    color: status.color,
  });
  return { backgroundColor: palette.background, color: palette.foreground };
}

type LeadDetailDrawerProps = {
  lead: LeadRow | null;
  sourceId: string;
  statuses: LeadStatus[];
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
  interactionTypes: LeadInteractionType[];
  /** Account names, so the rail shows people the way the board does. */
  nameByEmail: Map<string, string>;
  /** Owner emails this person may log against; null = every lead (a manager). */
  editableOwnerEmails: string[] | null;
  /** Managers can reassign; workers receive an empty list. */
  isManager: boolean;
  assignees: { email: string; name: string | null }[];
  onClose: () => void;
  onPatchLead: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onAssignLead: (id: string, email: string | null) => Promise<void>;
  onLeadUpdated: (lead: LeadRow, interaction?: LeadInteraction) => void;
};

/**
 * Lịch sử tương tác đã tải, giữ theo lead id ở phạm vi module.
 *
 * Người dùng mở một lead, đóng, mở lại lead bên cạnh rồi quay lại — ba lần gọi
 * mạng cho cùng một dữ liệu. Giữ ở đây chứ không trong state vì drawer bị gỡ
 * khỏi cây mỗi lần đóng.
 *
 * Giới hạn 50 lead gần nhất: đủ cho một phiên làm việc, và không giữ mãi một
 * mảng lịch sử nào sau khi người ta đã đi qua nó từ lâu.
 */
const interactionCache = new Map<string, LeadInteraction[]>();
const INTERACTION_CACHE_LIMIT = 50;

function rememberInteractions(leadId: string, rows: LeadInteraction[]) {
  interactionCache.delete(leadId);
  interactionCache.set(leadId, rows);
  if (interactionCache.size > INTERACTION_CACHE_LIMIT) {
    const oldest = interactionCache.keys().next().value;
    if (oldest !== undefined) interactionCache.delete(oldest);
  }
}

export function LeadDetailDrawer({
  lead,
  sourceId,
  statuses,
  columns,
  columnOptions,
  interactionTypes,
  editableOwnerEmails,
  isManager,
  assignees,
  nameByEmail,
  onClose,
  onPatchLead,
  onAssignLead,
  onLeadUpdated,
}: LeadDetailDrawerProps) {
  const [interactions, setInteractions] = useState<LeadInteraction[]>([]);
  const cachedInteractions = lead ? interactionCache.get(lead.id) : undefined;
  const [loadedLeadId, setLoadedLeadId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editError, setEditError] = useState<{
    leadId: string;
    message: string;
  } | null>(null);

  // Phụ thuộc theo ID chứ không theo cả object lead: sửa status ngay trong
  // drawer tạo ra một object lead mới, và bản cũ tải lại toàn bộ lịch sử chỉ vì
  // một trường không liên quan vừa đổi.
  const leadId = lead?.id ?? null;
  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    void fetch(`/api/leads/${leadId}/interactions`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(payload?.error ?? "Could not load interactions.");
        if (!Array.isArray(payload?.interactions))
          throw new Error("Could not load interactions.");
        rememberInteractions(leadId, payload.interactions as LeadInteraction[]);
        if (!cancelled) {
          setInteractions(payload.interactions as LeadInteraction[]);
          setLoadError(null);
          setLoadedLeadId(leadId);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not load interactions.",
          );
          setLoadedLeadId(leadId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  // Follow the same configuration contract as TaskDetailDrawer for editable
  // fields: system fields are available unless an admin hid them globally,
  // while custom fields must additionally opt into "Show in detail".
  // Optional audit metadata is deliberately separate: it is visible only
  // through its Details switch, so the rail does not regress to every audit
  // field being shown at once.
  // Personal table preferences never reach this component, so they cannot
  // accidentally hide an edit field in the modal.
  const configuredColumnKeys = useMemo(
    () =>
      new Set(
        columns
          .filter((column) => !column.archived_at)
          .map((column) => column.key),
      ),
    [columns],
  );
  const visibleColumnKeys = useMemo(
    () =>
      new Set(
        columns
          .filter((column) => !column.archived_at && !column.hidden_default)
          .map((column) => column.key),
      ),
    [columns],
  );
  const detailColumns = useMemo(
    () =>
      columns.filter(
        (column) =>
          column.show_in_detail &&
          !column.is_system &&
          !column.archived_at &&
          !column.hidden_default,
      ),
    [columns],
  );
  const currentLeadStatus = useMemo(
    () =>
      lead?.status_id
        ? statuses.find((s) => s.id === lead.status_id)
        : undefined,
    [lead, statuses],
  );
  const optionsByColumn = useMemo(() => {
    const map = new Map<string, TableColumnOption[]>();
    for (const option of columnOptions) {
      const list = map.get(option.column_id) ?? [];
      list.push(option);
      map.set(option.column_id, list);
    }
    return map;
  }, [columnOptions]);
  const productColumn = columns.find(
    (column) => column.key === "product" && !column.archived_at,
  );
  const createdAtColumn = columns.find(
    (column) =>
      column.key === "createdAt" && column.is_system && !column.archived_at,
  );
  const productOptions = productColumn
    ? optionsByColumn.get(productColumn.id) ?? []
    : [];
  const leadStatus = currentLeadStatus;
  useBodyScrollLock(Boolean(lead));
  if (!lead) return null;
  const currentLead = lead;
  // Có bản đã tải lần trước thì hiện luôn và tải lại ở nền. Mở lại đúng lead
  // vừa xem mà vẫn thấy khung "Loading" là một bước lùi không cần thiết — lịch
  // sử tương tác gần như không đổi giữa hai lần mở cách nhau vài giây.
  const loading = loadedLeadId !== currentLead.id && !cachedInteractions;
  const visibleInteractions =
    loadedLeadId === currentLead.id ? interactions : (cachedInteractions ?? []);
  const visibleError = loadedLeadId === currentLead.id ? loadError : null;
  // Same reach as editing: a manager (null scope) on any lead, a worker on
  // their own and on the leads of agents they assist. Assignment stays a
  // manager action because it writes an accountable hand-off history row.
  const canEdit = leadIsInScope(currentLead, editableOwnerEmails);
  const canLog = canEdit;
  const statusChoices = [
    { value: "", label: "No status" },
    ...statuses.map((status) => ({ value: status.id, label: status.label })),
  ];
  const assigneeChoices = [
    { value: "", label: "Unassigned" },
    ...assignees.map((person) => ({
      value: person.email,
      label: personLabel(person.email, nameByEmail),
      keywords: [person.email],
    })),
  ];
  const isUnassigned = !currentLead.assigned_to_email;
  const assigneeLabel = currentLead.assigned_to_email
    ? personLabel(currentLead.assigned_to_email, nameByEmail)
    : "Unassigned";
  const assigneeEmails = currentLead.assigned_to_email
    ? [currentLead.assigned_to_email]
    : [];
  const canAssign = isManager && canEdit;
  // A missing config row is kept visible for backwards-compatible database
  // rollouts, exactly as Task detail does. Once configured, Hidden controls it.
  const showField = (key: string) =>
    !configuredColumnKeys.has(key) || visibleColumnKeys.has(key);
  const showName = showField("name");
  const showPhone = showField("phone");
  const showEmail = showField("email");
  const showEvent = showField("event");
  const showProduct = showField("product");
  const showStatus = showField("status");
  const showAssignee = showField("assignee");
  const showFollowUp = showField("followUp");
  const showCreatedAt = Boolean(createdAtColumn?.show_in_detail);
  const hasRecordFields =
    showPhone || showEmail || showEvent || detailColumns.length > 0;
  const hasRailFields =
    showProduct || showStatus || showAssignee || showFollowUp || showCreatedAt;

  async function patchCurrentLead(patch: Record<string, unknown>) {
    setEditError(null);
    try {
      await onPatchLead(currentLead.id, patch);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not save that change.";
      setEditError({ leadId: currentLead.id, message });
      throw error;
    }
  }

  async function assignCurrentLead(email: string | null) {
    setEditError(null);
    try {
      await onAssignLead(currentLead.id, email);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reassign that lead.";
      setEditError({ leadId: currentLead.id, message });
      throw error;
    }
  }

  async function saveInteraction(payload: {
    type_id: string;
    status_id: string;
    note: string;
    follow_up_at: string | null;
    client_request_id: string;
  }) {
    const response = await fetch(`/api/leads/${currentLead.id}/interactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lead-client-source": sourceId,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(result?.error ?? "Could not save interaction.");
    const interaction = result.interaction as LeadInteraction;
    // Cùng một phép chống trùng như onInteractionSaved bên dưới: hai nơi ghi
    // cùng một danh sách thì phải ghi ra cùng một kết quả.
    rememberInteractions(
      currentLead.id,
      visibleInteractions.some((item) => item.id === interaction.id)
        ? visibleInteractions
        : [interaction, ...visibleInteractions],
    );
    if (result?.lead) onLeadUpdated(result.lead as LeadRow, interaction);
    return { interaction };
  }


  return (
    // The same shell as TaskDetailDrawer: a centred dialog rather than a side
    // sheet, work on the left and metadata in a 280px rail. Each column owns
    // its scrolling on wide screens, which is what keeps the composer docked at
    // the bottom however long the history gets.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Lead details"
        className="flex h-[calc(100vh-2rem)] max-h-[760px] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[#dfe1e6] px-5 py-3">
          <span className="font-mono text-sm font-bold text-[#97a0af]">
            {leadDisplayKey(currentLead.display_number)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1.5 text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto lg:overflow-hidden">
          <div
            className={`grid min-h-full grid-cols-1 lg:h-full ${
              hasRailFields ? "lg:grid-cols-[minmax(0,1fr)_280px]" : ""
            }`}
          >
            <main className="flex min-w-0 flex-col gap-3 p-4 lg:min-h-0 lg:overflow-hidden lg:p-5">
              {showName ? (
                <div className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>Client name{REQUIRED_MARK}</span>
                  <EditableCustomCell
                    column={{
                      id: "full_name",
                      key: "full_name",
                      label: "Client name",
                      type: "text",
                    }}
                    value={currentLead.full_name}
                    canEdit={canEdit}
                    onSave={(next) => patchCurrentLead({ full_name: next })}
                    className={COMPACT_DETAIL_INPUT_CLASS}
                    inputClassName={COMPACT_DETAIL_INPUT_CLASS}
                    emptyLabel="Unnamed lead"
                  />
                </div>
              ) : null}

              {editError?.leadId === currentLead.id ? (
                <p className="shrink-0 rounded-md border border-[#ffbdad] bg-[#fff7f5] px-3 py-2 text-xs font-semibold text-[#bf2600]">
                  {editError.message}
                </p>
              ) : null}

              {hasRecordFields ? (
                <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  {showPhone ? (
                    <div className={COMPACT_DETAIL_FIELD_CLASS}>
                      <span className={LABEL_CLASS}>Phone</span>
                      <EditableCustomCell
                        column={{ id: "phone", key: "phone", label: "Phone", type: "text" }}
                        value={currentLead.phone}
                        canEdit={canEdit}
                        onSave={(next) => patchCurrentLead({ phone: next })}
                        className={COMPACT_DETAIL_INPUT_CLASS}
                        inputClassName={COMPACT_DETAIL_INPUT_CLASS}
                        emptyLabel="No phone"
                      />
                    </div>
                  ) : null}
                  {showEmail ? (
                    <div className={COMPACT_DETAIL_FIELD_CLASS}>
                      <span className={LABEL_CLASS}>Email</span>
                      <EditableCustomCell
                        column={{ id: "email", key: "email", label: "Email", type: "text" }}
                        value={currentLead.email}
                        canEdit={canEdit}
                        onSave={(next) => patchCurrentLead({ email: next })}
                        className={COMPACT_DETAIL_INPUT_CLASS}
                        inputClassName={COMPACT_DETAIL_INPUT_CLASS}
                        emptyLabel="No email"
                      />
                    </div>
                  ) : null}
                  {showEvent ? (
                    <div className={COMPACT_DETAIL_FIELD_CLASS}>
                      <span className={LABEL_CLASS}>Event</span>
                      <EditableCustomCell
                        column={{ id: "event_name", key: "event_name", label: "Event", type: "text" }}
                        value={currentLead.event_name}
                        canEdit={canEdit}
                        onSave={(next) => patchCurrentLead({ event_name: next })}
                        className={COMPACT_DETAIL_INPUT_CLASS}
                        inputClassName={COMPACT_DETAIL_INPUT_CLASS}
                        emptyLabel="No event"
                      />
                    </div>
                  ) : null}
                  {detailColumns.map((column) => (
                    <div key={column.id} className={COMPACT_DETAIL_FIELD_CLASS}>
                      <span className={LABEL_CLASS}>
                        {column.label}
                        {column.required ? REQUIRED_MARK : null}
                      </span>
                      <EditableCustomCell
                        column={column}
                        value={currentLead.custom_values?.[column.key]}
                        options={optionsByColumn.get(column.id) ?? []}
                        people={assignees}
                        personLabelByEmail={nameByEmail}
                        canEdit={canEdit}
                        onSave={(next) =>
                          patchCurrentLead({
                            custom_values: { [column.key]: next },
                          })
                        }
                        className={COMPACT_DETAIL_INPUT_CLASS}
                        inputClassName={COMPACT_DETAIL_INPUT_CLASS}
                        emptyLabel={`No ${column.label}`}
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              <section className="flex min-h-0 flex-1 flex-col gap-3 border-t border-[#dfe1e6] pt-4">
                <InteractionLog
                  key={currentLead.id}
                  toolbar={
                    <LeadDetailTabButton
                      label="Interactions"
                      count={visibleInteractions.length}
                    />
                  }
                  notice={
                    <>
                      {loading ? (
                        <p className="shrink-0 text-sm text-[#6b778c]">
                          Loading interaction history...
                        </p>
                      ) : null}
                      {visibleError ? (
                        <p className="shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                          {visibleError}
                        </p>
                      ) : null}
                    </>
                  }
                  statuses={statuses}
                  interactionTypes={interactionTypes}
                  initialInteractions={visibleInteractions}
                  canLog={canLog}
                  ownerLabel={
                    currentLead.assigned_to_email
                      ? personLabel(currentLead.assigned_to_email, nameByEmail)
                      : null
                  }
                  sourceId={sourceId}
                  onSave={saveInteraction}
                  onInteractionSaved={(interaction) =>
                    setInteractions((current) =>
                      current.some((item) => item.id === interaction.id)
                        ? current
                        : [interaction, ...current],
                    )
                  }
                />
              </section>
            </main>

            {hasRailFields ? (
              <aside className="space-y-4 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0 lg:overflow-y-auto">
                <div className="space-y-3">
                  {showProduct ? (
                    <RailField label="Product">
                      {/* Cùng picker với ô Product ngoài bảng: một lead có thể
                          mang nhiều product, nên đây là chọn-nhiều chứ không
                          phải chọn-một. Hai màn hình, một cách bấm. */}
                      <ProductMenu
                        selected={currentLead.products ?? []}
                        options={productOptions}
                        canEdit={canEdit}
                        onToggle={(products: LeadProduct[]) =>
                          patchCurrentLead({ products })
                        }
                        showChevron
                        buttonClassName={RAIL_SELECT_BUTTON_CLASS}
                      />
                    </RailField>
                  ) : null}

                  {showStatus ? (
                    <RailField label="Status">
                      <LeadChoiceField
                        label={leadStatus?.label ?? "No status"}
                        ariaLabel="Status"
                        choices={statusChoices}
                        selectedValue={currentLead.status_id ?? ""}
                        canEdit={canEdit}
                        onSelect={(statusId) =>
                          patchCurrentLead({ status_id: statusId || null })
                        }
                        containerClassName="w-full"
                        buttonClassName={RAIL_SELECT_BUTTON_CLASS}
                        showChevron
                        renderValue={
                          leadStatus ? (
                            <span
                              className="inline-flex max-w-full min-w-0 items-center truncate rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.025em]"
                              style={statusBadgeStyle(leadStatus)}
                            >
                              {leadStatus.label}
                            </span>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-[#97a0af]">
                              No status
                            </span>
                          )
                        }
                      />
                    </RailField>
                  ) : null}

                  {showAssignee ? (
                    <RailField label="Assigned to">
                      {canAssign ? (
                        <LeadChoiceField
                          label={assigneeLabel}
                          ariaLabel="Assignee"
                          choices={assigneeChoices}
                          selectedValue={currentLead.assigned_to_email ?? ""}
                          canEdit
                          onSelect={(email) => assignCurrentLead(email || null)}
                          containerClassName="w-full"
                          buttonClassName={ASSIGNEE_SELECT_BUTTON_CLASS}
                          renderValue={
                            <>
                              <AvatarStack
                                emails={assigneeEmails}
                                labelByEmail={nameByEmail}
                                max={1}
                              />
                              <span
                                className={`min-w-0 flex-1 truncate ${
                                  isUnassigned
                                    ? "font-normal text-[#97a0af]"
                                    : "text-[#172b4d]"
                                }`}
                              >
                                {assigneeLabel}
                              </span>
                            </>
                          }
                        />
                      ) : (
                        <div className={READ_ONLY_ASSIGNEE_FIELD_CLASS}>
                          <AvatarStack
                            emails={assigneeEmails}
                            labelByEmail={nameByEmail}
                            max={1}
                          />
                          <span className="min-w-0 truncate">
                            {assigneeLabel}
                          </span>
                        </div>
                      )}
                    </RailField>
                  ) : null}

                  {showFollowUp ? (
                    <RailField label="Follow-up">
                      <EditableCustomCell
                        column={{
                          id: "next_follow_up_at",
                          key: "next_follow_up_at",
                          label: "Follow-up",
                          type: "date",
                        }}
                        value={
                          currentLead.next_follow_up_at
                            ? currentLead.next_follow_up_at.slice(0, 10)
                            : null
                        }
                        canEdit={canEdit}
                        onSave={(next) =>
                          patchCurrentLead({ next_follow_up_at: next })
                        }
                        className={`${COMPACT_DETAIL_INPUT_CLASS} !text-[#42526e]`}
                        inputClassName={`${COMPACT_DETAIL_INPUT_CLASS} !text-[#42526e]`}
                        emptyLabel="No follow-up"
                      />
                    </RailField>
                  ) : null}

                  {showCreatedAt ? (
                    <RailField label={createdAtColumn?.label ?? "Imported date"}>
                      <div className={READ_ONLY_METADATA_FIELD_CLASS}>
                        {displayDateTime(currentLead.created_at)}
                      </div>
                    </RailField>
                  ) : null}
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

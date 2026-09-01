"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  LeadInteraction,
  LeadInteractionType,
  LeadRow,
  LeadStatus,
} from "@/lib/leads/types";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { EditableCustomCell } from "../../_shared/EditableCustomCell";
import { InteractionLog } from "./InteractionLog";
import { LeadChoiceField } from "./LeadChoiceField";
import { leadDisplayKey } from "@/lib/leads/display";
import { leadIsInScope } from "@/lib/leads/capabilities";
import { personLabel } from "@/lib/tasks/people";
import { taskCategoryBadgePalette } from "@/lib/tasks/category-colors";
import { tableColumnOptionBadgePalette } from "@/lib/table-config/value-colors";
import { Initials } from "../../tasks/_components/board-ui";

// These mirror the compact field primitives in TaskDetailDrawer. Keeping them
// local lets Lead retain its domain-specific data while sharing the same UI
// rhythm: labels, 36px controls, and disabled/audit states.
const LABEL_CLASS = "text-xs font-bold uppercase tracking-wide text-[#6b778c]";
const INPUT_CLASS =
  "w-full rounded border-2 border-[#dfe1e6] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none transition hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:border-[#dfe1e6] disabled:bg-[#f4f5f7] disabled:text-[#6b778c]";
const COMPACT_DETAIL_FIELD_CLASS = "block shrink-0 space-y-1";
const COMPACT_DETAIL_INPUT_CLASS = `${INPUT_CLASS} h-9 !px-2 !py-1.5 font-semibold`;
const RAIL_FIELD_CLASS =
  "flex min-h-9 items-center rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-sm font-semibold text-[#172b4d]";
const RAIL_READ_ONLY_FIELD_CLASS =
  "flex min-h-9 items-center rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-2 text-sm font-medium text-[#172b4d]";
const RAIL_SELECT_BUTTON_CLASS =
  "!h-9 !w-full !justify-between !rounded-lg !border-2 !border-[#dfe1e6] !bg-white !px-2 !text-sm !font-semibold !text-[#172b4d] !shadow-none hover:!border-[#c1c7d0] hover:!bg-white disabled:!cursor-not-allowed disabled:!bg-[#f4f5f7] disabled:!text-[#6b778c]";
const REQUIRED_MARK = <span className="text-[#bf2600]"> *</span>;

const EMPTY = "—";

const PRODUCT_CHOICES = [
  { value: "pc", label: "P&C" },
  { value: "health", label: "Health" },
];

function displayDateTime(value: string | null): string {
  if (!value) return EMPTY;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? EMPTY : date.toLocaleString();
}

/** The two labels the Product column's configured values are seeded with. */
function productOptionLabel(product: LeadRow["product"]): string {
  return product === "health" ? "Health" : "P&C";
}

/** The same palette the task board gives its categories, so the two read alike. */
function statusBadgeStyle(status: LeadStatus) {
  const palette = taskCategoryBadgePalette({
    id: status.id,
    name: status.label,
    color: status.color,
  });
  return { backgroundColor: palette.background, color: palette.foreground };
}

/** Same colour rules as the list's Product badge: config first, hash fallback. */
function optionBadgeStyle(
  option: TableColumnOption | undefined,
  label: string,
) {
  const palette = tableColumnOptionBadgePalette(
    option ?? { id: label, label, color: null },
  );
  return { backgroundColor: palette.background, color: palette.foreground };
}

function RailField({
  label,
  children,
  control = false,
  muted = false,
}: {
  label: string;
  children: ReactNode;
  /** The child already owns the input/dropdown chrome. */
  control?: boolean;
  /** Audit-only facts use the disabled treatment from Task details. */
  muted?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      {control ? (
        children
      ) : (
        <div className={muted ? RAIL_READ_ONLY_FIELD_CLASS : RAIL_FIELD_CLASS}>
          {children}
        </div>
      )}
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
  const [loadedLeadId, setLoadedLeadId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editError, setEditError] = useState<{
    leadId: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!lead) return;
    let cancelled = false;
    void fetch(`/api/leads/${lead.id}/interactions`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(payload?.error ?? "Could not load interactions.");
        if (!Array.isArray(payload?.interactions))
          throw new Error("Could not load interactions.");
        if (!cancelled) {
          setInteractions(payload.interactions as LeadInteraction[]);
          setLoadError(null);
          setLoadedLeadId(lead.id);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not load interactions.",
          );
          setLoadedLeadId(lead.id);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lead]);

  // Only the columns an admin marked "In detail", and only the ones backed by
  // custom_values — the system columns already have their own rows above.
  const detailColumns = useMemo(
    () =>
      columns.filter(
        (column) =>
          !column.is_system && !column.archived_at && column.show_in_detail,
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
  const productOption = productColumn
    ? optionsByColumn
        .get(productColumn.id)
        ?.find(
          (candidate) =>
            candidate.label === productOptionLabel(lead?.product ?? "pc"),
        )
    : undefined;
  const leadStatus = currentLeadStatus;
  if (!lead) return null;
  const currentLead = lead;
  const loading = loadedLeadId !== currentLead.id;
  const visibleInteractions =
    loadedLeadId === currentLead.id ? interactions : [];
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
          <div className="grid min-h-full grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_280px]">
            <main className="flex min-w-0 flex-col gap-3 p-4 lg:min-h-0 lg:overflow-hidden lg:p-5">
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

              {editError?.leadId === currentLead.id ? (
                <p className="shrink-0 rounded-md border border-[#ffbdad] bg-[#fff7f5] px-3 py-2 text-xs font-semibold text-[#bf2600]">
                  {editError.message}
                </p>
              ) : null}

              {/* The record fields use the same labelled input treatment as
                  Client Name/FUB in Task details. Audit facts remain in the
                  rail so nobody confuses contact counters for editable data. */}
              <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2">
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

              <section className="flex min-h-0 flex-1 flex-col gap-3 border-t border-[#dfe1e6] pt-4">
                <div className="flex shrink-0 flex-wrap items-center gap-5 border-b border-[#dfe1e6]">
                  <LeadDetailTabButton
                    label="Interactions"
                    count={visibleInteractions.length}
                  />
                </div>

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
                <InteractionLog
                  key={currentLead.id}
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
                />
              </section>
            </main>

            <aside className="space-y-4 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0 lg:overflow-y-auto">
              <div className="space-y-3">
                <RailField label="Product" control>
                  <LeadChoiceField
                    label={productOptionLabel(currentLead.product)}
                    ariaLabel="Product"
                    choices={PRODUCT_CHOICES}
                    selectedValue={currentLead.product}
                    canEdit={canEdit}
                    onSelect={(product) => patchCurrentLead({ product })}
                    containerClassName="w-full"
                    buttonClassName={RAIL_SELECT_BUTTON_CLASS}
                    showChevron
                    renderValue={
                      <span
                        className="inline-flex max-w-full min-w-0 items-center truncate rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.025em]"
                        style={optionBadgeStyle(
                          productOption,
                          productOptionLabel(currentLead.product),
                        )}
                      >
                        {productOptionLabel(currentLead.product)}
                      </span>
                    }
                  />
                </RailField>

                <RailField label="Status" control>
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

                <RailField label="Assigned to" control>
                  <LeadChoiceField
                    label={
                      currentLead.assigned_to_email
                        ? personLabel(currentLead.assigned_to_email, nameByEmail)
                        : "Unassigned"
                    }
                    ariaLabel="Assignee"
                    choices={assigneeChoices}
                    selectedValue={currentLead.assigned_to_email ?? ""}
                    canEdit={isManager && canEdit}
                    onSelect={(email) => assignCurrentLead(email || null)}
                    containerClassName="w-full"
                    buttonClassName={RAIL_SELECT_BUTTON_CLASS}
                    showChevron
                    renderValue={
                      currentLead.assigned_to_email ? (
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <Initials
                            email={currentLead.assigned_to_email}
                            label={personLabel(currentLead.assigned_to_email, nameByEmail)}
                          />
                          <span className="truncate">
                            {personLabel(currentLead.assigned_to_email, nameByEmail)}
                          </span>
                        </span>
                      ) : (
                        <span className="min-w-0 flex-1 truncate font-normal text-[#97a0af]">
                          Unassigned
                        </span>
                      )
                    }
                  />
                </RailField>

                <RailField label="Assigned by" muted>
                  {currentLead.assigned_by_email ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <Initials
                        email={currentLead.assigned_by_email}
                        label={personLabel(currentLead.assigned_by_email, nameByEmail)}
                      />
                      <span className="truncate">
                        {personLabel(currentLead.assigned_by_email, nameByEmail)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[#8993a4]">{EMPTY}</span>
                  )}
                </RailField>
                <RailField label="Assigned at" muted>
                  {displayDateTime(currentLead.assigned_at)}
                </RailField>
              </div>

              <div className="space-y-3 border-t border-[#dfe1e6] pt-3">
                <RailField label="Attempts" muted>
                  {currentLead.contact_attempt_count}
                </RailField>
                <RailField label="First contact" muted>
                  {currentLead.first_contacted_at
                    ? displayDateTime(currentLead.first_contacted_at)
                    : "Never"}
                </RailField>
                <RailField label="Last contact" muted>
                  {currentLead.last_contacted_at
                    ? displayDateTime(currentLead.last_contacted_at)
                    : "Never"}
                </RailField>
                <RailField label="Follow-up" control>
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
                {currentLead.closed_at ? (
                  <RailField label="Closed" muted>
                    {displayDateTime(currentLead.closed_at)}
                  </RailField>
                ) : null}
              </div>

              <div className="space-y-3 border-t border-[#dfe1e6] pt-3">
                <RailField label="Imported by" muted>
                  <span className="flex min-w-0 items-center gap-2">
                    <Initials
                      email={currentLead.created_by_email}
                      label={personLabel(currentLead.created_by_email, nameByEmail)}
                    />
                    <span className="truncate">
                      {personLabel(currentLead.created_by_email, nameByEmail)}
                    </span>
                  </span>
                </RailField>
                <RailField label="Imported at" muted>
                  {displayDateTime(currentLead.created_at)}
                </RailField>
                <RailField label="Last edited by" muted>
                  {currentLead.updated_by_email ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <Initials
                        email={currentLead.updated_by_email}
                        label={personLabel(currentLead.updated_by_email, nameByEmail)}
                      />
                      <span className="truncate">
                        {personLabel(currentLead.updated_by_email, nameByEmail)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[#8993a4]">{EMPTY}</span>
                  )}
                </RailField>
                <RailField label="Last edited at" muted>
                  {displayDateTime(currentLead.updated_at)}
                </RailField>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

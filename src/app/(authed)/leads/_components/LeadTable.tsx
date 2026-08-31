"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CSSProperties,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from "lucide-react";
import { EditableCustomCell } from "../../_shared/EditableCustomCell";
import { SearchableListboxPanel } from "../../_shared/SearchableListboxPanel";
import { useAnchoredMenu } from "../../tasks/_components/use-anchored-menu";
import { leadDisplayKey } from "@/lib/leads/display";
import { leadIsInScope } from "@/lib/leads/capabilities";
import {
  isLeadSortKey,
  type LeadSortKey,
  type SortDir,
} from "@/lib/leads/sorting";
import type {
  LeadInteractionPreview,
  LeadInteractionType,
  LeadRow,
  LeadStatus,
} from "@/lib/leads/types";
import { personLabel } from "@/lib/tasks/people";
import { taskCategoryBadgePalette } from "@/lib/tasks/category-colors";
import { tableColumnOptionBadgePalette } from "@/lib/table-config/value-colors";
import { Initials } from "../../tasks/_components/board-ui";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";

const LEAD_COLUMN_WIDTHS: Record<string, number> = {
  key: 100,
  // A person name needs noticeably less room than a task title. Keep it
  // compact without truncating ordinary full names, so the table exposes more
  // useful lead data before horizontal scrolling starts.
  name: 240,
  phone: 140,
  secondary_phone: 180,
  email: 240,
  assignee: 190,
  status: 140,
  // Five 44px interaction badges + four gaps fit inside this cell. More
  // history is available by dragging the cell without moving the full table.
  interactionHistory: 272,
  attempts: 100,
  lastContact: 140,
  followUp: 140,
  event: 180,
  createdAt: 136,
};

const SELECTION_COLUMN_WIDTH = 48;
const DEFAULT_COLUMN_WIDTH = 180;

type LeadTableProps = {
  leads: LeadRow[];
  columns: TableColumn[];
  statuses: LeadStatus[];
  interactionTypes: LeadInteractionType[];
  columnOptions: TableColumnOption[];
  nameByEmail: Map<string, string>;
  isManager: boolean;
  /** Agents the manager can hand a lead to; empty for a non-manager. */
  assignees: { email: string; name: string | null }[];
  /** Owner emails this person may edit; null = every lead (a manager). */
  editableOwnerEmails: string[] | null;
  selected: ReadonlySet<string>;
  allVisibleSelected: boolean;
  onToggleLead: (id: string) => void;
  onSelectVisible: (selected: boolean) => void;
  onOpenLead: (lead: LeadRow) => void;
  onPatchLead: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onAssignLead: (id: string, email: string | null) => Promise<void>;
  sortKey: LeadSortKey | null;
  sortDir: SortDir;
  onSort?: (key: LeadSortKey) => void;
};

export function LeadTable({
  sortKey,
  sortDir,
  onSort,
  assignees,
  editableOwnerEmails,
  onPatchLead,
  onAssignLead,
  leads,
  columns,
  statuses,
  interactionTypes,
  columnOptions,
  nameByEmail,
  isManager,
  selected,
  allVisibleSelected,
  onToggleLead,
  onSelectVisible,
  onOpenLead,
}: LeadTableProps) {
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  const interactionTypeById = new Map(
    interactionTypes.map((type) => [type.id, type]),
  );
  const optionsByColumn = new Map<string, TableColumnOption[]>();
  for (const option of columnOptions) {
    optionsByColumn.set(option.column_id, [
      ...(optionsByColumn.get(option.column_id) ?? []),
      option,
    ]);
  }

  // "No status" is a real choice: a lead can sit in the pool before anyone has
  // spoken to it, and an agent must be able to put one back there.
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

  const staticColumnWidth = isManager ? SELECTION_COLUMN_WIDTH : 0;
  const pinnedOffsetByKey = buildPinnedOffsetByKey(
    columns,
    staticColumnWidth,
  );
  const minWidth =
    staticColumnWidth +
    columns.reduce((sum, column) => sum + leadColumnWidth(column), 0);
  const tableFrameStyle: CSSProperties = { maxHeight: "1008px" };

  if (leads.length === 0) {
    return (
      <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
        No leads match the current filters.
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]"
      style={tableFrameStyle}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth }}>
          <div className="sticky top-0 z-20 flex items-stretch whitespace-nowrap border-b border-[#dfe1e6] bg-[#fafbfc] text-[11px] font-bold uppercase tracking-wide text-[#6b778c] shadow-[0_1px_0_#dfe1e6]">
            {isManager ? (
              <div
                style={{ width: SELECTION_COLUMN_WIDTH, left: 0 }}
                className="sticky z-[30] flex shrink-0 items-center border-r border-[#dfe1e6] bg-[#fafbfc] px-3 py-2"
              >
                <input
                  className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]"
                  type="checkbox"
                  aria-label="Select visible leads"
                  checked={allVisibleSelected}
                  onChange={(event) => onSelectVisible(event.target.checked)}
                />
              </div>
            ) : null}
            {columns.map((column) => (
              <LeadHeaderCell
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                key={column.id}
                column={column}
                pinnedOffset={pinnedOffsetByKey.get(column.key)}
              />
            ))}
          </div>

          <ul>
            {leads.map((lead) => {
              const status = lead.status_id
                ? statusById.get(lead.status_id)
                : undefined;
              return (
                <li key={lead.id} className="border-b border-[#ebecf0]">
                  <LeadRow
                    lead={lead}
                    columns={columns}
                    status={status}
                    statuses={statusById}
                    interactionTypeById={interactionTypeById}
                    optionsByColumn={optionsByColumn}
                    nameByEmail={nameByEmail}
                    statusChoices={statusChoices}
                    assigneeChoices={assigneeChoices}
                    isManager={isManager}
                    canEdit={leadIsInScope(lead, editableOwnerEmails)}
                    selected={selected.has(lead.id)}
                    pinnedOffsetByKey={pinnedOffsetByKey}
                    onToggle={() => onToggleLead(lead.id)}
                    onOpen={() => onOpenLead(lead)}
                    onPatch={(patch) => onPatchLead(lead.id, patch)}
                    onAssign={(email) => onAssignLead(lead.id, email)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function LeadHeaderCell({
  column,
  pinnedOffset,
  sortKey,
  sortDir,
  onSort,
}: {
  column: TableColumn;
  pinnedOffset?: number;
  sortKey: LeadSortKey | null;
  sortDir: SortDir;
  onSort?: (key: LeadSortKey) => void;
}) {
  const width = leadColumnWidth(column);
  // Only the columns sortValue() knows how to compare. A custom column holds
  // whatever an admin put there, so there is no meaningful order to offer.
  const sortable = onSort && isLeadSortKey(column.key);
  const active = sortable && sortKey === column.key;
  const base = `flex shrink-0 items-center px-3 py-2 ${
    pinnedOffset === undefined
      ? ""
      : "sticky z-[30] border-r border-[#dfe1e6] bg-[#fafbfc]"
  }`;

  if (!sortable) {
    return (
      <div style={{ width, left: pinnedOffset }} className={base}>
        <span className="truncate uppercase">{column.label}</span>
      </div>
    );
  }

  return (
    <div style={{ width, left: pinnedOffset }} className={base}>
      <button
        type="button"
        onClick={() => onSort(column.key as LeadSortKey)}
        aria-label={
          active
            ? `${column.label}, sorted ${sortDir === "asc" ? "ascending" : "descending"}`
            : `Sort by ${column.label}`
        }
        className={`group flex min-w-0 items-center gap-1 rounded text-left uppercase transition hover:text-[#0c66e4] ${
          active ? "text-[#0c66e4]" : ""
        }`}
      >
        <span className="truncate uppercase">{column.label}</span>
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3 shrink-0" />
          ) : (
            <ArrowDown className="h-3 w-3 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-40" />
        )}
      </button>
    </div>
  );
}

function LeadRow({
  lead,
  columns,
  status,
  statuses,
  interactionTypeById,
  optionsByColumn,
  nameByEmail,
  statusChoices,
  assigneeChoices,
  isManager,
  canEdit,
  selected,
  pinnedOffsetByKey,
  onToggle,
  onOpen,
  onPatch,
  onAssign,
}: {
  lead: LeadRow;
  columns: TableColumn[];
  status: LeadStatus | undefined;
  statuses: ReadonlyMap<string, LeadStatus>;
  interactionTypeById: ReadonlyMap<string, LeadInteractionType>;
  optionsByColumn: ReadonlyMap<string, TableColumnOption[]>;
  nameByEmail: Map<string, string>;
  statusChoices: readonly { value: string; label: string }[];
  assigneeChoices: readonly { value: string; label: string; keywords?: string[] }[];
  isManager: boolean;
  canEdit: boolean;
  selected: boolean;
  pinnedOffsetByKey: ReadonlyMap<string, number>;
  onToggle: () => void;
  onOpen: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onAssign: (email: string | null) => Promise<void>;
}) {
  return (
    <div
      className="group flex min-h-11 min-w-max cursor-pointer items-stretch gap-0 whitespace-nowrap bg-white px-0 py-0 transition hover:bg-[#f7f8f9] [&>*]:flex [&>*]:items-center [&>*]:whitespace-nowrap [&>*]:px-3 [&>*]:py-2.5"
      onClick={onOpen}
    >
      {isManager ? (
        <StaticCell width={SELECTION_COLUMN_WIDTH} left={0}>
          <input
            className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]"
            type="checkbox"
            aria-label={`Select lead ${lead.display_number}`}
            checked={selected}
            onClick={stopPropagation}
            onChange={onToggle}
          />
        </StaticCell>
      ) : null}

      {columns.map((column) => (
        <LeadDataCell
          key={column.id}
          lead={lead}
          column={column}
          status={status}
          statuses={statuses}
          interactionTypeById={interactionTypeById}
          options={optionsByColumn.get(column.id) ?? []}
          nameByEmail={nameByEmail}
          statusChoices={statusChoices}
          assigneeChoices={assigneeChoices}
          canEdit={canEdit}
          canAssign={isManager}
          pinnedOffset={pinnedOffsetByKey.get(column.key)}
          onOpen={onOpen}
          onPatch={onPatch}
          onAssign={onAssign}
        />
      ))}
    </div>
  );
}

/**
 * A dropdown cell. Same shape as EditableCustomCell's choice branch — trigger
 * button, portal listbox, save on pick — but the values here are lead rows
 * (a status, a product, an agent), not table_column_option ids, so it cannot
 * reuse that component directly.
 */
function LeadChoiceCell({
  label,
  ariaLabel,
  choices,
  selectedValue,
  canEdit,
  renderValue,
  onSelect,
}: {
  label: string;
  ariaLabel: string;
  choices: readonly { value: string; label: string; keywords?: string[] }[];
  selectedValue: string;
  canEdit: boolean;
  renderValue: ReactNode;
  onSelect: (value: string) => void | Promise<void>;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, closeMenu, closeMenuForTab } =
    useAnchoredMenu();
  const [saveError, setSaveError] = useState(false);

  async function commit(next: string) {
    closeMenu({ restoreFocus: true });
    if (next === selectedValue) return;
    setSaveError(false);
    try {
      await onSelect(next);
    } catch {
      setSaveError(true);
    }
  }

  return (
    <span className="relative block min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        disabled={!canEdit}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={saveError ? "Save failed. Try again." : label}
        className={`flex min-w-0 max-w-full items-center gap-2 truncate rounded px-1.5 py-1 text-left transition hover:bg-[#f4f5f7] disabled:cursor-default disabled:hover:bg-transparent ${
          saveError ? "ring-2 ring-[#ff5630] ring-offset-1" : ""
        }`}
      >
        {renderValue}
      </button>
      {isOpen
        ? createPortal(
            <SearchableListboxPanel
              menuRef={menuRef}
              menuStyle={menuStyle}
              className="min-w-[13rem]"
              ariaLabel={ariaLabel}
              queryPlaceholder={`Search ${ariaLabel.toLowerCase()}…`}
              emptyMessage={`No matching ${ariaLabel.toLowerCase()}.`}
              choices={choices}
              selectedValue={selectedValue}
              onSelect={(value) => void commit(value)}
              onTabExit={closeMenuForTab}
            />,
            document.body,
          )
        : null}
    </span>
  );
}

function LeadDataCell({
  lead,
  column,
  status,
  statuses,
  interactionTypeById,
  options,
  nameByEmail,
  statusChoices,
  assigneeChoices,
  canEdit,
  canAssign,
  pinnedOffset,
  onOpen,
  onPatch,
  onAssign,
}: {
  lead: LeadRow;
  column: TableColumn;
  status: LeadStatus | undefined;
  statuses: ReadonlyMap<string, LeadStatus>;
  interactionTypeById: ReadonlyMap<string, LeadInteractionType>;
  options: TableColumnOption[];
  nameByEmail: Map<string, string>;
  statusChoices: readonly { value: string; label: string }[];
  assigneeChoices: readonly { value: string; label: string; keywords?: string[] }[];
  canEdit: boolean;
  canAssign: boolean;
  pinnedOffset?: number;
  onOpen: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onAssign: (email: string | null) => Promise<void>;
}) {
  const width = leadColumnWidth(column);
  const isPinned = pinnedOffset !== undefined;
  const baseClassName = `flex shrink-0 min-w-0 ${
    isPinned
      ? "sticky z-[2] border-r border-[#dfe1e6] bg-white group-hover:bg-[#f7f8f9]"
      : ""
  }`;
  const style: CSSProperties = { width, left: pinnedOffset };

  if (column.key === "key") {
    return (
      <div style={style} className={baseClassName}>
        <span className="truncate font-mono text-xs font-bold text-[#97a0af]">
          {leadDisplayKey(lead.display_number)}
        </span>
      </div>
    );
  }

  if (column.key === "name") {
    return (
      <div style={style} className={`${baseClassName} gap-1.5`}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-sm font-medium text-[#172b4d] transition hover:bg-[#f4f5f7] hover:text-[#0c66e4]"
          title={lead.full_name ?? "Unnamed lead"}
        >
          <span className="block truncate">
            {lead.full_name ?? "Unnamed lead"}
          </span>
        </button>
      </div>
    );
  }

  // Editable system fields. Name stays a link to the lead, matching how the
  // task list treats its summary: the row's title is how you open the record.
  if (column.key === "phone" || column.key === "email") {
    return (
      <div style={style} className={baseClassName}>
        <EditableCustomCell
          column={{ id: column.id, key: column.key, label: column.label, type: "text" }}
          value={column.key === "phone" ? lead.phone : lead.email}
          canEdit={canEdit}
          onSave={(next) => onPatch({ [column.key]: next })}
          className="w-full"
        />
      </div>
    );
  }

  if (column.key === "event") {
    // Typed, not chosen: the route finds or creates the event by name, so a
    // lead never waits on someone registering it first.
    return (
      <div style={style} className={baseClassName}>
        <EditableCustomCell
          column={{ id: column.id, key: "event_name", label: column.label, type: "text" }}
          value={lead.event_name}
          canEdit={canEdit}
          onSave={(next) => onPatch({ event_name: next })}
          className="w-full"
        />
      </div>
    );
  }

  if (column.key === "followUp") {
    return (
      <div style={style} className={baseClassName}>
        <EditableCustomCell
          column={{ id: column.id, key: column.key, label: column.label, type: "date" }}
          value={lead.next_follow_up_at ? lead.next_follow_up_at.slice(0, 10) : null}
          canEdit={canEdit}
          onSave={(next) => onPatch({ next_follow_up_at: next })}
          className="w-full !font-medium !text-[#6b778c]"
        />
      </div>
    );
  }

  if (column.key === "product") {
    return (
      <div style={style} className={baseClassName}>
        <LeadChoiceCell
          label={productOptionLabel(lead.product)}
          ariaLabel="Product"
          choices={PRODUCT_CHOICES}
          selectedValue={lead.product}
          canEdit={canEdit}
          onSelect={(value) => onPatch({ product: value })}
          renderValue={<ProductBadge product={lead.product} options={options} />}
        />
      </div>
    );
  }

  if (column.key === "status") {
    return (
      <div style={style} className={baseClassName}>
        <LeadChoiceCell
          label={status?.label ?? "No status"}
          ariaLabel="Status"
          choices={statusChoices}
          selectedValue={lead.status_id ?? ""}
          canEdit={canEdit}
          onSelect={(value) => onPatch({ status_id: value })}
          renderValue={<StatusBadge status={status} />}
        />
      </div>
    );
  }

  if (column.key === "assignee") {
    const label = lead.assigned_to_email
      ? personLabel(lead.assigned_to_email, nameByEmail)
      : "Unassigned";
    return (
      <div style={style} className={baseClassName}>
        <LeadChoiceCell
          label={label}
          ariaLabel="Assignee"
          choices={assigneeChoices}
          selectedValue={lead.assigned_to_email ?? ""}
          canEdit={canAssign}
          onSelect={(value) => onAssign(value || null)}
          renderValue={
            lead.assigned_to_email ? (
              <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#42526e]">
                <Initials email={lead.assigned_to_email} label={label} />
                <span className="truncate">{label}</span>
              </span>
            ) : (
              <span className="text-xs font-semibold text-[#97a0af]">Unassigned</span>
            )
          }
        />
      </div>
    );
  }

  if (!column.is_system) {
    return (
      <div style={style} className={`${baseClassName} items-center ${
        column.type === "checkbox" ? "justify-center" : ""
      }`}>
        <EditableCustomCell
          column={column}
          value={lead.custom_values?.[column.key]}
          options={options}
          canEdit={canEdit}
          onSave={(next) => onPatch({ custom_values: { [column.key]: next } })}
          className={column.type === "checkbox" ? "" : "w-full"}
        />
      </div>
    );
  }

  if (column.key === "interactionHistory") {
    return (
      <div style={style} className={baseClassName}>
        <InteractionHistoryCell
          interactions={lead.interaction_history ?? []}
          interactionTypeById={interactionTypeById}
        />
      </div>
    );
  }

  return (
    <div style={style} className={baseClassName}>
      {renderLeadCell(lead, column, status, statuses, options, nameByEmail)}
    </div>
  );
}

function renderLeadCell(
  lead: LeadRow,
  column: TableColumn,
  status: LeadStatus | undefined,
  statuses: ReadonlyMap<string, LeadStatus>,
  options: TableColumnOption[],
  nameByEmail: Map<string, string>,
): ReactNode {
  if (column.key === "assignee") {
    if (!lead.assigned_to_email) {
      return (
        <span className="text-xs font-semibold text-[#97a0af]">
          Unassigned
        </span>
      );
    }
    const label = personLabel(lead.assigned_to_email, nameByEmail);
    return (
      <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#42526e]">
        <Initials email={lead.assigned_to_email} label={label} />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  if (column.key === "status") {
    return <StatusBadge status={status} />;
  }

  if (column.key === "product") {
    return <ProductBadge product={lead.product} options={options} />;
  }

  const value = leadColumnValue(lead, column, statuses, options, nameByEmail);
  if (column.type === "checkbox") {
    return value === "Yes" ? (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#e3fcef] text-[#006644]">
        <Check className="h-3.5 w-3.5" />
      </span>
    ) : (
      <span className="text-[#8993a4]">—</span>
    );
  }

  const isPlaceholder = value === "—";
  const textClassName = leadValueClassName(column, isPlaceholder);
  return (
    <span className={`min-w-0 truncate ${textClassName}`} title={value}>
      {value}
    </span>
  );
}

const PRODUCT_CHOICES = [
  { value: "pc", label: "P&C" },
  { value: "health", label: "Health" },
];

/** The two labels the Product column's configured values are seeded with. */
function productOptionLabel(product: LeadRow["product"]): string {
  return product === "health" ? "Health" : "P&C";
}

/**
 * Product is a dropdown, so its colour is config data like every other dropdown
 * value — it lives on the column's options and an admin owns it. The join is by
 * label, which is why Lead Config locks the label on this column. Before the
 * rollout seeds those rows the badge still renders, on the shared hashed
 * fallback, rather than showing a bare word where every neighbour is a badge.
 */
function ProductBadge({
  product,
  options,
}: {
  product: LeadRow["product"];
  options: TableColumnOption[];
}) {
  const label = productOptionLabel(product);
  const option = options.find((candidate) => candidate.label === label);
  const palette = tableColumnOptionBadgePalette(
    option ?? { id: label, label, color: null },
  );
  return (
    <span
      className="inline-flex max-w-full items-center truncate whitespace-nowrap rounded px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-wide"
      style={{ backgroundColor: palette.background, color: palette.foreground }}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: LeadStatus | undefined }) {
  if (!status) {
    return <span className="text-[11px] font-semibold text-[#97a0af]">—</span>;
  }
  const palette = taskCategoryBadgePalette({
    id: status.id,
    name: status.label,
    color: status.color,
  });
  return (
    <span
      className="inline-flex max-w-full items-center truncate whitespace-nowrap rounded px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-wide"
      style={{ backgroundColor: palette.background, color: palette.foreground }}
    >
      {status.label}
    </span>
  );
}

function InteractionHistoryCell({
  interactions,
  interactionTypeById,
}: {
  interactions: LeadInteractionPreview[];
  interactionTypeById: ReadonlyMap<string, LeadInteractionType>;
}) {
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
  } | null>(null);

  if (interactions.length === 0) {
    return <span className="text-xs font-semibold text-[#97a0af]">—</span>;
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const distance = event.clientX - currentDrag.startX;
    if (Math.abs(distance) > 2) event.preventDefault();
    event.currentTarget.scrollLeft = currentDrag.startScrollLeft - distance;
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      tabIndex={0}
      aria-label={`Interaction history: ${interactions.length} entries, newest first. Drag horizontally to browse.`}
      className="flex w-full min-w-0 cursor-grab touch-pan-y snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain select-none scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden active:cursor-grabbing"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.scrollBy({
          left: event.key === "ArrowLeft" ? -72 : 72,
          behavior: "smooth",
        });
      }}
    >
      {interactions.map((interaction) => {
        const interactionType = interactionTypeById.get(interaction.type_id);
        const label = interactionType?.label ?? "Unknown";
        const palette = interactionBadgePalette(interactionType, label);
        return (
          <span
            className="inline-flex h-5 w-11 shrink-0 snap-start items-center justify-center truncate rounded-[3px] px-1.5 text-[10px] font-bold uppercase leading-none tracking-[0.025em]"
            key={interaction.id}
            style={{
              backgroundColor: palette.background,
              color: palette.foreground,
            }}
            title={interactionTitle(label, interaction.occurred_at)}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

const INTERACTION_BADGE_FALLBACKS: Record<
  string,
  { background: string; foreground: string }
> = {
  call: { background: "#deebff", foreground: "#0055cc" },
  email: { background: "#eae6ff", foreground: "#403294" },
  text: { background: "#e3fcef", foreground: "#006644" },
  note: { background: "#f4f5f7", foreground: "#42526e" },
  unknown: { background: "#dfe1e6", foreground: "#42526e" },
};

function interactionBadgePalette(
  interactionType: LeadInteractionType | undefined,
  label: string,
): { background: string; foreground: string } {
  const fallback = INTERACTION_BADGE_FALLBACKS[label.trim().toLowerCase()];
  if (!interactionType?.color && fallback) return fallback;
  return taskCategoryBadgePalette({
    id: interactionType?.id ?? label,
    name: interactionType?.label ?? label,
    color: interactionType?.color ?? null,
  });
}

function interactionTitle(label: string, occurredAt: string): string {
  const date = new Date(occurredAt);
  return Number.isNaN(date.getTime())
    ? label
    : `${label} · ${date.toLocaleString()}`;
}

function leadColumnValue(
  lead: LeadRow,
  column: TableColumn,
  statuses: ReadonlyMap<string, LeadStatus>,
  options: TableColumnOption[],
  nameByEmail: Map<string, string>,
): string {
  switch (column.key) {
    case "phone":
      return lead.phone ?? "—";
    case "email":
      return lead.email ?? "—";
    case "attempts":
      return String(lead.contact_attempt_count);
    case "lastContact":
      return displayDate(lead.last_contacted_at);
    case "followUp":
      return displayDate(lead.next_follow_up_at);
    case "event":
      return lead.event_name ?? "—";
    case "product":
      return productOptionLabel(lead.product);
    case "createdAt":
      return displayDate(lead.created_at);
    case "name":
      return lead.full_name ?? "—";
    case "assignee":
      return lead.assigned_to_email
        ? personLabel(lead.assigned_to_email, nameByEmail)
        : "Unassigned";
    case "status":
      return lead.status_id
        ? (statuses.get(lead.status_id)?.label ?? "Unknown status")
        : "—";
    default: {
      const rawValue = lead.custom_values?.[column.key];
      if (column.type === "checkbox") return rawValue === true ? "Yes" : "No";
      if (rawValue === null || rawValue === undefined || rawValue === "") {
        return "—";
      }
      const option = options.find(
        (candidate) => candidate.label === String(rawValue),
      );
      return option?.label ?? String(rawValue);
    }
  }
}

function displayDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function leadColumnWidth(column: TableColumn): number {
  return LEAD_COLUMN_WIDTHS[column.key] ??
    (column.type === "checkbox" ? 100 : DEFAULT_COLUMN_WIDTH);
}

function leadValueClassName(
  column: TableColumn,
  isPlaceholder: boolean,
): string {
  const muted = isPlaceholder ? "text-[#97a0af]" : "";
  if (
    column.key === "lastContact" ||
    column.key === "followUp" ||
    column.key === "createdAt"
  ) {
    return `text-[11px] font-medium ${
      isPlaceholder ? "text-[#97a0af]" : "text-[#6b778c]"
    }`;
  }
  if (column.key === "attempts") {
    return `text-xs font-bold ${
      isPlaceholder ? "text-[#97a0af]" : "text-[#42526e]"
    }`;
  }
  return `text-sm font-medium ${muted || "text-[#172b4d]"}`;
}

function buildPinnedOffsetByKey(
  columns: readonly TableColumn[],
  start: number,
): Map<string, number> {
  const offsets = new Map<string, number>();
  let left = start;
  for (const column of columns) {
    if (!column.pinned) continue;
    offsets.set(column.key, left);
    left += leadColumnWidth(column);
  }
  return offsets;
}

function StaticCell({
  width,
  left,
  className = "",
  title,
  children,
  ...props
}: {
  width: number;
  left: number;
  className?: string;
  title?: string;
  children: ReactNode;
} & Pick<React.HTMLAttributes<HTMLDivElement>, "aria-label">) {
  return (
    <div
      style={{ width, left }}
      className={`sticky z-[2] shrink-0 border-r border-[#dfe1e6] bg-white group-hover:bg-[#f7f8f9] ${className}`}
      title={title}
      {...props}
    >
      {children}
    </div>
  );
}

function stopPropagation(event: MouseEvent<HTMLInputElement>) {
  event.stopPropagation();
}

"use client";

import { useRef } from "react";
import type {
  CSSProperties,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { Check } from "lucide-react";
import { leadDisplayKey } from "@/lib/leads/display";
import type {
  LeadInteractionPreview,
  LeadInteractionType,
  LeadRow,
  LeadStatus,
} from "@/lib/leads/types";
import { personLabel } from "@/lib/tasks/people";
import { taskCategoryBadgePalette } from "@/lib/tasks/category-colors";
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
  // Five 42px labels + four gaps fit inside this cell. More history is
  // available by dragging the cell without moving the full table.
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
  selected: ReadonlySet<string>;
  allVisibleSelected: boolean;
  onToggleLead: (id: string) => void;
  onSelectVisible: (selected: boolean) => void;
  onOpenLead: (lead: LeadRow) => void;
};

export function LeadTable({
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
                    isManager={isManager}
                    selected={selected.has(lead.id)}
                    pinnedOffsetByKey={pinnedOffsetByKey}
                    onToggle={() => onToggleLead(lead.id)}
                    onOpen={() => onOpenLead(lead)}
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
}: {
  column: TableColumn;
  pinnedOffset?: number;
}) {
  const width = leadColumnWidth(column);
  return (
    <div
      style={{ width, left: pinnedOffset }}
      className={`flex shrink-0 items-center px-3 py-2 ${
        pinnedOffset === undefined
          ? ""
          : "sticky z-[30] border-r border-[#dfe1e6] bg-[#fafbfc]"
      }`}
    >
      <span className="truncate">{column.label}</span>
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
  isManager,
  selected,
  pinnedOffsetByKey,
  onToggle,
  onOpen,
}: {
  lead: LeadRow;
  columns: TableColumn[];
  status: LeadStatus | undefined;
  statuses: ReadonlyMap<string, LeadStatus>;
  interactionTypeById: ReadonlyMap<string, LeadInteractionType>;
  optionsByColumn: ReadonlyMap<string, TableColumnOption[]>;
  nameByEmail: Map<string, string>;
  isManager: boolean;
  selected: boolean;
  pinnedOffsetByKey: ReadonlyMap<string, number>;
  onToggle: () => void;
  onOpen: () => void;
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
          pinnedOffset={pinnedOffsetByKey.get(column.key)}
          onOpen={onOpen}
        />
      ))}
    </div>
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
  pinnedOffset,
  onOpen,
}: {
  lead: LeadRow;
  column: TableColumn;
  status: LeadStatus | undefined;
  statuses: ReadonlyMap<string, LeadStatus>;
  interactionTypeById: ReadonlyMap<string, LeadInteractionType>;
  options: TableColumnOption[];
  nameByEmail: Map<string, string>;
  pinnedOffset?: number;
  onOpen: () => void;
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
      className="flex w-full min-w-0 cursor-grab touch-pan-y snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain select-none scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden active:cursor-grabbing"
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
        const label =
          interactionTypeById.get(interaction.type_id)?.label ?? "Unknown";
        return (
          <span
            className="w-[42px] shrink-0 snap-start truncate text-xs font-semibold text-[#42526e]"
            key={interaction.id}
            title={interactionTitle(label, interaction.occurred_at)}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
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
      return lead.event_id ?? "—";
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

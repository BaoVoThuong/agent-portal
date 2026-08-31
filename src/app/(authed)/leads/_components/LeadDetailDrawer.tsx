"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  LeadInteraction,
  LeadInteractionType,
  LeadRow,
  LeadStatus,
} from "@/lib/leads/types";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { InteractionLog } from "./InteractionLog";
import { leadDisplayKey } from "@/lib/leads/display";
import { leadIsInScope } from "@/lib/leads/capabilities";
import { personLabel } from "@/lib/tasks/people";
import { taskCategoryBadgePalette } from "@/lib/tasks/category-colors";
import { tableColumnOptionBadgePalette } from "@/lib/table-config/value-colors";
import { Initials } from "../../tasks/_components/board-ui";

const LABEL_CLASS =
  "text-[11px] font-bold uppercase tracking-[0.06em] text-[#667085]";

const EMPTY = "—";

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

/** Mirrors the table's default branch so the drawer and the list never disagree. */
function customValue(
  lead: LeadRow,
  column: TableColumn,
  optionsByColumn: Map<string, TableColumnOption[]>,
): string {
  const value = lead.custom_values?.[column.key];
  if (value === null || value === undefined || value === "") return "—";
  const option = optionsByColumn
    .get(column.id)
    ?.find((candidate) => candidate.label === String(value));
  return option?.label ?? String(value);
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
  onClose: () => void;
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
  nameByEmail,
  onClose,
  onLeadUpdated,
}: LeadDetailDrawerProps) {
  const [interactions, setInteractions] = useState<LeadInteraction[]>([]);
  const [loadedLeadId, setLoadedLeadId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  // their own and on the leads of agents they assist.
  const canLog = leadIsInScope(currentLead, editableOwnerEmails);

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

  function detailField(label: string, value: React.ReactNode) {
    return (
      <div className="space-y-1.5" key={label}>
        <span className={LABEL_CLASS}>{label}</span>
        <div className="flex min-h-9 items-center rounded-lg border-2 border-[#dfe1e6] bg-white px-2 text-sm font-medium text-[#172b4d]">
          {value}
        </div>
      </div>
    );
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
              <div className="shrink-0 space-y-1">
                <h2 className="text-xl font-semibold text-[#172b4d]">
                  {currentLead.full_name || "Unnamed lead"}
                </h2>
              </div>

              {/* Phone, email and event were one grey subtitle line. They are
                  the three things someone opens a lead to read, so they get
                  labelled fields like every other value — and the event is the
                  only place the drawer says where this lead came from. */}
              <div className="grid shrink-0 grid-cols-2 gap-3">
                {detailField(
                  "Phone",
                  currentLead.phone ? (
                    <a
                      className="truncate font-semibold text-[#0c66e4] hover:underline"
                      href={`tel:${currentLead.phone}`}
                    >
                      {currentLead.phone}
                    </a>
                  ) : (
                    <span className="text-[#8993a4]">{EMPTY}</span>
                  ),
                )}
                {detailField(
                  "Email",
                  currentLead.email ? (
                    <a
                      className="truncate font-semibold text-[#0c66e4] hover:underline"
                      href={`mailto:${currentLead.email}`}
                      title={currentLead.email}
                    >
                      {currentLead.email}
                    </a>
                  ) : (
                    <span className="text-[#8993a4]">{EMPTY}</span>
                  ),
                )}
                {detailField(
                  "Event",
                  currentLead.event_id ? (
                    <span className="truncate" title={currentLead.event_id}>
                      {currentLead.event_id}
                    </span>
                  ) : (
                    <span className="text-[#8993a4]">{EMPTY}</span>
                  ),
                )}
                {detailColumns.map((column) =>
                  detailField(
                    column.label,
                    customValue(currentLead, column, optionsByColumn),
                  ),
                )}
              </div>

              <section className="flex min-h-0 flex-1 flex-col gap-3 border-t border-[#dfe1e6] pt-4">
                <div className="flex shrink-0 flex-wrap items-center gap-5 border-b border-[#dfe1e6]">
                  <span className="-mb-px border-b-2 border-[#0c66e4] pb-2 text-sm font-bold text-[#0c66e4]">
                    Interactions
                    <span className="ml-1.5 rounded-full bg-[#e9f2ff] px-1.5 py-0.5 text-[11px] font-bold text-[#0c66e4]">
                      {visibleInteractions.length}
                    </span>
                  </span>
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

            <aside className="space-y-3 border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0 lg:overflow-y-auto">
              {detailField(
                "Product",
                <span
                  className="inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide"
                  style={optionBadgeStyle(
                    productOption,
                    productOptionLabel(currentLead.product),
                  )}
                >
                  {productOptionLabel(currentLead.product)}
                </span>,
              )}
              {detailField(
                "Status",
                leadStatus ? (
                  <span
                    className="inline-flex items-center rounded px-2 py-0.5 text-xs font-bold"
                    style={statusBadgeStyle(leadStatus)}
                  >
                    {leadStatus.label}
                  </span>
                ) : (
                  <span className="text-[#8993a4]">—</span>
                ),
              )}
              {detailField(
                "Assigned to",
                currentLead.assigned_to_email ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <Initials
                      email={currentLead.assigned_to_email}
                      label={personLabel(currentLead.assigned_to_email, nameByEmail)}
                    />
                    <span className="truncate">
                      {personLabel(currentLead.assigned_to_email, nameByEmail)}
                    </span>
                  </span>
                ) : (
                  <span className="text-[#8993a4]">Unassigned</span>
                ),
              )}
              {/* Who handed this lead over and when. The whole point of the
                  module is that an assignment is accountable, and until now the
                  drawer showed the owner without showing who put them there. */}
              {detailField(
                "Assigned by",
                currentLead.assigned_by_email ? (
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
                ),
              )}
              {detailField("Assigned at", displayDateTime(currentLead.assigned_at))}

              <div className="space-y-3 border-t border-[#dfe1e6] pt-3">
                {detailField("Attempts", currentLead.contact_attempt_count)}
                {detailField(
                  "First contact",
                  currentLead.first_contacted_at
                    ? displayDateTime(currentLead.first_contacted_at)
                    : "Never",
                )}
                {detailField(
                  "Last contact",
                  currentLead.last_contacted_at
                    ? displayDateTime(currentLead.last_contacted_at)
                    : "Never",
                )}
                {detailField(
                  "Follow-up",
                  displayDateTime(currentLead.next_follow_up_at),
                )}
                {currentLead.closed_at
                  ? detailField("Closed", displayDateTime(currentLead.closed_at))
                  : null}
              </div>

              {/* Record history. Imported-by answers "where did this row come
                  from" on a table that is mostly filled by spreadsheet import. */}
              <div className="space-y-3 border-t border-[#dfe1e6] pt-3">
                {detailField(
                  "Imported by",
                  <span className="flex min-w-0 items-center gap-2">
                    <Initials
                      email={currentLead.created_by_email}
                      label={personLabel(currentLead.created_by_email, nameByEmail)}
                    />
                    <span className="truncate">
                      {personLabel(currentLead.created_by_email, nameByEmail)}
                    </span>
                  </span>,
                )}
                {detailField("Imported at", displayDateTime(currentLead.created_at))}
                {detailField(
                  "Last edited by",
                  currentLead.updated_by_email ? (
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
                  ),
                )}
                {detailField("Last edited at", displayDateTime(currentLead.updated_at))}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

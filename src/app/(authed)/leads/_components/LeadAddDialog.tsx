"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { resolveDialogProduct } from "@/lib/leads/create";
import type { LeadProduct, LeadStatus } from "@/lib/leads/types";
import { useBodyScrollLock } from "../../_shared/useBodyScrollLock";

type LeadEvent = {
  id: string;
  name: string;
  event_date: string | null;
};

type LeadAddDialogProps = {
  open: boolean;
  /** null = màn hình đang xem mọi product, dialog phải hỏi. */
  productFilter: LeadProduct | null;
  sourceId: string;
  columns: TableColumn[];
  /** Accounts that may hold a lead. Empty for a non-manager, who cannot assign. */
  assignees: { email: string; name: string | null }[];
  columnOptions: TableColumnOption[];
  statuses: LeadStatus[];
  onClose: () => void;
  onCreated: () => Promise<void>;
};

const INPUT_CLASS =
  "h-10 w-full rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
const LABEL_CLASS = "block text-xs font-bold uppercase text-[#6b778c]";

function formatEvent(event: LeadEvent): string {
  return event.event_date ? `${event.name} · ${event.event_date}` : event.name;
}

function fieldLabel(
  columns: TableColumn[],
  key: string,
  fallback: string,
): string {
  return columns.find((column) => column.key === key)?.label ?? fallback;
}

function isFilled(value: unknown, type?: TableColumn["type"]): boolean {
  if (type === "checkbox")
    return value !== null && value !== undefined && value !== "";
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

function requiredSystemValue(
  key: string,
  values: Record<string, unknown>,
): unknown {
  return values[key];
}

function CustomLeadField({
  column,
  options,
  value,
  onChange,
}: {
  column: TableColumn;
  options: TableColumnOption[];
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (column.type === "checkbox") {
    return (
      <label className="flex h-10 items-center gap-2 border-2 border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#344054]">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]"
        />
        {column.label}
      </label>
    );
  }

  if (column.type === "dropdown") {
    return (
      <select
        className={INPUT_CLASS}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose {column.label.toLowerCase()}</option>
        {options
          .filter((option) => !option.archived_at)
          .map((option) => (
            // Giá trị là option.id, giống Task và Enrollment. Gửi label thì
            // ô inline edit (khớp theo id) sẽ hiện rỗng ngay sau khi tạo.
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
      </select>
    );
  }

  return (
    <input
      className={INPUT_CLASS}
      type={
        column.type === "number"
          ? "number"
          : column.type === "date"
            ? "date"
            : "text"
      }
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(event) =>
        onChange(
          column.type === "number" ? event.target.value : event.target.value,
        )
      }
      placeholder={
        column.type === "link"
          ? "https://..."
          : `Enter ${column.label.toLowerCase()}`
      }
    />
  );
}

export function LeadAddDialog({
  open,
  productFilter,
  sourceId,
  columns,
  columnOptions,
  assignees,
  statuses,
  onClose,
  onCreated,
}: LeadAddDialogProps) {
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [eventsState, setEventsState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [eventName, setEventName] = useState("");
  const [assignedToEmail, setAssignedToEmail] = useState("");
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Only asked for when the screen is not already scoped to one product.
  const [chosenProduct, setChosenProduct] = useState<LeadProduct | null>(null);
  const product = resolveDialogProduct(productFilter, chosenProduct);

  const customColumns = useMemo(
    () =>
      columns.filter(
        (column) =>
          !column.is_system && !column.archived_at && column.show_in_detail,
      ),
    [columns],
  );
  const optionsByColumnId = useMemo(() => {
    const result = new Map<string, TableColumnOption[]>();
    for (const option of columnOptions) {
      result.set(option.column_id, [
        ...(result.get(option.column_id) ?? []),
        option,
      ]);
    }
    return result;
  }, [columnOptions]);
  // A lead being created has not been worked yet, so it starts at the first
  // open status — "New" in the seeded vocabulary. Picked by position and kind
  // rather than by the label "New", because an admin may rename it.
  //
  // Not editable here: status is meant to move when someone logs an
  // interaction, which is what keeps contact_attempt_count and the alert
  // clocks honest. Letting the creator set "Won" before anyone has called
  // would produce a closed lead with no call behind it.
  const selectedStatusId =
    statuses.find((status) => status.kind === "open")?.id ??
    statuses[0]?.id ??
    "";
  const selectedStatusLabel =
    statuses.find((status) => status.id === selectedStatusId)?.label ?? "—";

  useEffect(() => {
    if (!open || eventsState !== "idle") return;
    void fetch("/api/leads/events", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(payload?.error ?? "Could not load events.");
        setEvents(
          Array.isArray(payload?.events) ? (payload.events as LeadEvent[]) : [],
        );
        setEventsState("ready");
      })
      .catch(() => setEventsState("error"));
  }, [eventsState, open]);

  function setCustomValue(key: string, value: unknown) {
    setCustomValues((current) => ({ ...current, [key]: value }));
  }

  function resetAndClose() {
    setFullName("");
    setPhone("");
    setEmail("");
    setEventName("");
    setAssignedToEmail("");
    setCustomValues({});
    setError(null);
    setEventsState("idle");
    onClose();
  }

  async function submit() {
    if (saving) return;
    // The button is disabled without one, but the guard belongs here too: a
    // lead filed under the wrong product is invisible to the team that owns it.
    if (!product) {
      setError("Choose a product for this lead.");
      return;
    }
    const fieldValues: Record<string, unknown> = {
      name: fullName,
      phone,
      email,
      assignee: assignedToEmail,
      status: selectedStatusId,
    };
    const missing = columns
      .filter((column) => column.required && !column.archived_at)
      .filter((column) => {
        const value = column.is_system
          ? requiredSystemValue(column.key, fieldValues)
          : customValues[column.key];
        return !isFilled(value, column.type);
      });
    if (missing.length > 0 || !phone.trim()) {
      const labels = [
        ...missing.map((field) => field.label),
        ...(phone.trim() ? [] : ["Phone"]),
      ].filter((label, index, list) => list.indexOf(label) === index);
      setError(`${labels.join(", ")} required.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-lead-client-source": sourceId,
        },
        body: JSON.stringify({
          product,
          full_name: fullName,
          phone,
          email,
          event_name: eventName.trim() || null,
          status_id: selectedStatusId || null,
          assigned_to_email: assignedToEmail,
          custom_values: customValues,
          client_request_id: crypto.randomUUID(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? "Could not create lead.");
      await onCreated();
      resetAndClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not create lead.",
      );
    } finally {
      setSaving(false);
    }
  }

  useBodyScrollLock(open);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Add lead"
    >
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#e9f2ff] text-[#0c66e4]">
              <Plus className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-[#172b4d]">
                Add {product ? (product === "pc" ? "P&C" : "Health") : ""} lead
              </h2>
              <p className="mt-1 text-sm text-[#626f86]">
                Create one lead and optionally assign it immediately.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            disabled={saving}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d] disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <section className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className={LABEL_CLASS}>
                    {fieldLabel(columns, "name", "Full name")}
                  </span>
                  <input
                    className={INPUT_CLASS}
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Client name"
                    autoFocus
                  />
                </label>
                <label className="block space-y-1">
                  <span className={LABEL_CLASS}>
                    Phone <span className="text-[#bf2600]">*</span>
                  </span>
                  <input
                    className={INPUT_CLASS}
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="Phone number"
                    inputMode="tel"
                    required
                  />
                </label>
                <label className="block space-y-1 sm:col-span-2">
                  <span className={LABEL_CLASS}>
                    {fieldLabel(columns, "email", "Email")}
                  </span>
                  <input
                    className={INPUT_CLASS}
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="client@example.com"
                  />
                </label>
              </div>

              {customColumns.length > 0 ? (
                <div className="border-t border-[#e6eaf0] pt-4">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-[#667085]">
                    Additional information
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {customColumns.map((column) => (
                      <label key={column.id} className="block space-y-1">
                        <span className={LABEL_CLASS}>
                          {column.label}
                          {column.required ? (
                            <span className="text-[#bf2600]"> *</span>
                          ) : null}
                        </span>
                        <CustomLeadField
                          column={column}
                          options={optionsByColumnId.get(column.id) ?? []}
                          value={customValues[column.key]}
                          onChange={(value) =>
                            setCustomValue(column.key, value)
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <aside className="space-y-4 border-t border-[#dfe1e6] bg-[#f7f9fc] p-4 lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between border-b border-[#dfe1e6] pb-3">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#667085]">
                  Lead properties
                </span>
                {productFilter ? (
                  <span className="rounded bg-[#e9f2ff] px-2 py-0.5 text-xs font-bold text-[#0c66e4]">
                    {productFilter === "pc" ? "P&C" : "Health"}
                  </span>
                ) : (
                  // Bắt buộc chọn: đoán ở đây là xếp nhầm lead vào sổ khác.
                  <select
                    className="rounded border border-[#c1c7d0] bg-white px-2 py-1 text-xs font-bold text-[#172b4d] outline-none focus:border-[#0c66e4]"
                    aria-label="Product"
                    value={chosenProduct ?? ""}
                    onChange={(event) =>
                      setChosenProduct(
                        event.target.value === "pc" || event.target.value === "health"
                          ? event.target.value
                          : null,
                      )
                    }
                  >
                    <option value="">Choose product…</option>
                    <option value="pc">P&C</option>
                    <option value="health">Health</option>
                  </select>
                )}
              </div>
              <label className="block space-y-1">
                <span className={LABEL_CLASS}>
                  {fieldLabel(columns, "event", "Event")}
                </span>
                {/* Typed, not chosen: a lead should never wait on someone
                    registering the event first. The route matches the name
                    case-insensitively and creates the event when it is new, so
                    the per-event report still groups by a real row. The list
                    below is a suggestion, not a constraint. */}
                <input
                  className={INPUT_CLASS}
                  list="lead-event-names"
                  value={eventName}
                  onChange={(event) => setEventName(event.target.value)}
                  placeholder="e.g. Health Fair 2026"
                />
                <datalist id="lead-event-names">
                  {events.map((event) => (
                    <option key={event.id} value={event.name}>
                      {formatEvent(event)}
                    </option>
                  ))}
                </datalist>
                {eventsState === "error" ? (
                  <span className="text-xs font-semibold text-rose-700">
                    Could not load past events; you can still type a name.
                  </span>
                ) : null}
              </label>
              <div className="block space-y-1">
                <span className={LABEL_CLASS}>
                  {fieldLabel(columns, "status", "Status")}
                </span>
                <p
                  className={`${INPUT_CLASS} flex items-center bg-[#f4f5f7] text-[#42526e]`}
                >
                  {selectedStatusLabel}
                </p>
                <span className="text-xs text-[#667085]">
                  Set automatically; it moves when an interaction is logged.
                </span>
              </div>
              <label className="block space-y-1">
                <span className={LABEL_CLASS}>
                  {fieldLabel(columns, "assignee", "Assign to")}
                </span>
                {/* A roster, not a free-text address. The server rejects an
                    account that cannot hold a lead, but a manager should not
                    have to recall ~50 exact addresses to find that out. */}
                <select
                  className={INPUT_CLASS}
                  value={assignedToEmail}
                  onChange={(event) => setAssignedToEmail(event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {assignees.map((person) => (
                    <option key={person.email} value={person.email}>
                      {person.name?.trim() || person.email}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs leading-5 text-[#667085]">
                Phone numbers are normalized automatically. Duplicate phone
                numbers are blocked within the same event.
              </p>
            </aside>
          </div>
          {error ? (
            <p
              className="mt-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#dfe1e6] bg-white px-6 py-4">
          <button
            type="button"
            onClick={resetAndClose}
            disabled={saving}
            className="rounded px-4 py-2 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !product}
            title={product ? undefined : "Choose a product first."}
            className="inline-flex h-9 items-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            {saving ? "Creating..." : "Create lead"}
          </button>
        </footer>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { resolveDialogProduct } from "@/lib/leads/create";
import {
  isPersonalLeadEventName,
  LEAD_TYPE_LABEL,
  LEAD_TYPES,
  type LeadType,
} from "@/lib/leads/lead-type";
import {
  isLeadProduct,
  LEAD_PRODUCT_LABEL,
  LEAD_PRODUCTS,
  type LeadProduct,
  type LeadRow,
  type LeadStatus,
} from "@/lib/leads/types";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";
import { TaskSelect } from "../../_components/TaskSelect";
import {
  fetchLeadEvents,
  peekLeadEvents,
  type LeadEventOption as LeadEvent,
} from "@/lib/leads/events-cache";
import {
  addPendingFiles,
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  removePendingFile,
  type PendingFile,
} from "@/lib/tasks/pending-attachments";
import { formatAttachmentSize } from "@/lib/tasks/attachments";
import { tableColumnOptionBadgePalette } from "@/lib/table-config/value-colors";
import { LeadCollaboratorsPicker } from "./LeadCollaboratorsPicker";

type LeadAddDialogProps = {
  open: boolean;
  /** null = màn hình đang xem mọi product, dialog phải hỏi. */
  productFilter: LeadProduct | null;
  sourceId: string;
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
  statuses: LeadStatus[];
  assignees: { email: string; name: string | null }[];
  /** Personal lead mặc định thuộc về người tạo. */
  currentUserEmail: string;
  onClose: () => void;
  /**
   * Gọi ngay khi server đã tạo lead; hộp đóng luôn, không chờ. Trang cha nạp
   * dòng mới và tải file chạy nền (plan instant feedback T2.3).
   */
  onCreated: (lead: LeadRow, files: PendingFile[]) => void;
};

type DistributionAgent = {
  email: string;
  name: string | null;
  products: LeadProduct[];
};

const INPUT_CLASS =
  "h-10 w-full rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
const SELECT_BUTTON_CLASS =
  "!h-10 !rounded !border-2 !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";
const PROPERTY_SELECT_BUTTON_CLASS =
  "!h-10 !border-[#dfe1e6] !bg-white !shadow-none";
const LABEL_CLASS = "block text-xs font-bold uppercase text-[#6b778c]";
const TEXTAREA_CLASS =
  "min-h-[18rem] w-full resize-y rounded border-2 border-[#dfe1e6] bg-white px-3 py-3 text-sm leading-6 text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
const PRODUCT_OPTIONS = LEAD_PRODUCTS.map((value) => ({
  value,
  label: LEAD_PRODUCT_LABEL[value],
}));

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
      <TaskSelect
        label={column.label}
        value={typeof value === "string" ? value : ""}
        options={options
          .filter((option) => !option.archived_at)
          .map((option) => ({
            // Giá trị là option.id, giống Task và Enrollment. Gửi label thì
            // ô inline edit (khớp theo id) sẽ hiện rỗng ngay sau khi tạo.
            value: option.id,
            label: option.label,
          }))}
        placeholder={`Choose ${column.label.toLowerCase()}`}
        className="w-full"
        buttonClassName={SELECT_BUTTON_CLASS}
        menuClassName="max-h-64 min-w-full"
        onChange={onChange}
      />
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
  statuses,
  assignees,
  currentUserEmail,
  onClose,
  onCreated,
}: LeadAddDialogProps) {
  // Mở lại dialog lần thứ hai không phải chờ danh sách sự kiện nữa: bản đã tải
  // hiện ra ngay, lần tải nền bên dưới chỉ để bắt sự kiện mới.
  const [events, setEvents] = useState<LeadEvent[]>(
    () => peekLeadEvents()?.events ?? [],
  );
  const [eventsState, setEventsState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fubLink, setFubLink] = useState("");
  const [description, setDescription] = useState("");
  const [leadType, setLeadType] = useState<LeadType>("event");
  const [eventName, setEventName] = useState("");
  const [assignedToEmail, setAssignedToEmail] = useState("");
  const [collaboratorEmails, setCollaboratorEmails] = useState<string[]>([]);
  const [distributionAgents, setDistributionAgents] = useState<DistributionAgent[] | null>(null);
  const [distributionAgentsError, setDistributionAgentsError] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createRequestIdRef = useRef<string | null>(null);
  // Only asked for when the screen is not already scoped to one product.
  const [chosenProduct, setChosenProduct] = useState<LeadProduct | null>("unknown");
  const product = resolveDialogProduct(productFilter, chosenProduct);
  const productAgents = distributionAgents?.filter((agent) =>
    product ? agent.products.includes(product) : false,
  ) ?? [];
  const isPersonalLead = leadType === "personal";
  const actorEmail = currentUserEmail.trim().toLowerCase();
  // Personal lead không qua Distribute pool: giao được cho bất kỳ ai có quyền
  // Lead, và chưa chọn ai thì người tạo giữ (route cũng mặc định như vậy).
  const personalAgents = assignees.some((person) => person.email === actorEmail)
    ? assignees
    : [{ email: actorEmail, name: null }, ...assignees];
  const effectiveAssignee = isPersonalLead
    ? assignedToEmail || actorEmail
    : assignedToEmail;
  // Event cũ tên "Personal Lead" (cách đánh dấu trước khi có Lead type) không
  // còn là một event để gợi ý.
  const suggestedEvents = events.filter((event) => !isPersonalLeadEventName(event.name));

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
  const productColumn = columns.find(
    (column) => column.key === "product" && !column.archived_at,
  );
  const productColorOptions = productColumn
    ? optionsByColumnId.get(productColumn.id) ?? []
    : [];
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
    void fetchLeadEvents()
      .then((payload) => {
        setEvents(payload.events);
        setEventsState("ready");
      })
      .catch(() => setEventsState("error"));
  }, [eventsState, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/leads/assignment-roster", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.agents)) {
          throw new Error(payload?.error ?? "Could not load the receiving agents.");
        }
        if (!cancelled) {
          setDistributionAgents(payload.agents as DistributionAgent[]);
          setDistributionAgentsError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setDistributionAgentsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function chooseLeadType(next: LeadType) {
    setLeadType(next);
    // Người được chọn cho Personal lead có thể không nằm trong Distribute pool
    // của product — quay lại Event lead thì bỏ chọn, như khi đổi product.
    if (
      next === "event" &&
      assignedToEmail &&
      !productAgents.some((agent) => agent.email === assignedToEmail)
    ) {
      setAssignedToEmail("");
    }
  }

  function setCustomValue(key: string, value: unknown) {
    setCustomValues((current) => ({ ...current, [key]: value }));
  }

  function chooseProduct(value: string) {
    const nextProduct = isLeadProduct(value) ? value : null;
    setChosenProduct(nextProduct);
    if (
      assignedToEmail &&
      !distributionAgents?.some(
        (agent) =>
          agent.email === assignedToEmail &&
          nextProduct !== null &&
          agent.products.includes(nextProduct),
      )
    ) {
      setAssignedToEmail("");
    }
  }

  function resetAndClose() {
    setFullName("");
    setPhone("");
    setEmail("");
    setFubLink("");
    setDescription("");
    setLeadType("event");
    setEventName("");
    setAssignedToEmail("");
    setCollaboratorEmails([]);
    setDistributionAgents(null);
    setDistributionAgentsError(false);
    setChosenProduct("unknown");
    setCustomValues({});
    setPendingFiles([]);
    setFileError(null);
    createRequestIdRef.current = null;
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
      fub: fubLink,
      description,
      assignee: effectiveAssignee,
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
    // Không có event thì lead là Personal — Event lead trống event là mâu thuẫn.
    const missingEvent =
      !isPersonalLead && (!eventName.trim() || isPersonalLeadEventName(eventName));
    if (missing.length > 0 || !phone.trim() || missingEvent) {
      const labels = [
        ...missing.map((field) => field.label),
        ...(phone.trim() ? [] : ["Phone"]),
        ...(missingEvent ? [fieldLabel(columns, "event", "Event")] : []),
      ].filter((label, index, list) => list.indexOf(label) === index);
      setError(`${labels.join(", ")} required.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // Cùng `client_request_id` cho mọi lần bấm của một lần mở hộp: mạng rớt
      // sau khi server đã ghi thì bấm lại nhận về đúng lead đó, không tạo trùng.
      createRequestIdRef.current ??= crypto.randomUUID();
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
          fub_link: fubLink.trim() || null,
          description: description.trim() || null,
          lead_type: leadType,
          event_name: isPersonalLead ? null : eventName.trim() || null,
          status_id: selectedStatusId || null,
          assigned_to_email: effectiveAssignee,
          collaborator_emails: collaboratorEmails,
          custom_values: customValues,
          client_request_id: createRequestIdRef.current,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.lead?.id)
        throw new Error(payload?.error ?? "Could not create lead.");
      // Lead đã có trên server: đóng hộp ngay. Trang cha nạp dòng mới và tải
      // file chạy nền — không bắt người dùng chờ tải lại cả danh sách và từng
      // file như trước.
      onCreated(payload.lead as LeadRow, pendingFiles);
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
      <div className="flex max-h-[calc(100dvh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-[#172b4d]">
              New {product ? `${LEAD_PRODUCT_LABEL[product]} ` : ""}lead
            </h2>
            <p className="mt-1 text-sm text-[#626f86]">
              Capture the lead details, then set ownership on the right.
            </p>
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="min-w-0 space-y-4 px-6 py-5">
              <fieldset disabled={saving} className="space-y-4">
              <label className="block space-y-1">
                <span className={LABEL_CLASS}>
                  {fieldLabel(columns, "name", "Client name")}
                  {columns.some((column) => column.key === "name" && column.required) ? <span className="text-[#bf2600]"> *</span> : null}
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
                <span className={LABEL_CLASS}>{fieldLabel(columns, "fub", "FUB link")}</span>
                <input
                  className={INPUT_CLASS}
                  type="url"
                  value={fubLink}
                  onChange={(event) => setFubLink(event.target.value)}
                  placeholder="https://app.followupboss.com/..."
                />
              </label>
              <label className="block space-y-1">
                <span className={LABEL_CLASS}>Description</span>
                <textarea
                  className={TEXTAREA_CLASS}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Add context, notes, links, or customer details..."
                  maxLength={10_000}
                  rows={12}
                />
              </label>
              </fieldset>
              <div className="space-y-1">
                <span className={LABEL_CLASS}>Attachments</span>
                <div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                    className="inline-flex h-10 items-center gap-1.5 rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#42526e] transition hover:border-[#c1c7d0] hover:bg-[#f7f8fa] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Paperclip className="h-4 w-4 text-[#667085]" /> Add files
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
                    className="hidden"
                    onChange={(event) => {
                      const incoming = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      const result = addPendingFiles(pendingFiles, incoming);
                      if (!result.ok) {
                        setFileError(result.message);
                        return;
                      }
                      setPendingFiles(result.files);
                      setFileError(null);
                    }}
                  />
                </div>
                {pendingFiles.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5 pt-1">
                    {pendingFiles.map((item) => (
                      <li key={item.key} className="inline-flex max-w-[16rem] items-center gap-1 rounded border border-[#dfe1e6] bg-[#f7f8fa] px-2 py-1 text-xs text-[#42526e]">
                        <span className="truncate" title={item.name}>{item.name}</span>
                        <span className="shrink-0 text-[#7a869a]">{formatAttachmentSize(item.size)}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${item.name}`}
                          disabled={saving}
                          onClick={() => {
                            setPendingFiles((current) => removePendingFile(current, item.key));
                            setFileError(null);
                          }}
                          className="shrink-0 rounded p-0.5 text-[#667085] hover:bg-[#e4e7ec] hover:text-[#344054] disabled:opacity-50"
                        ><X className="h-3.5 w-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {fileError ? <p role="alert" className="text-xs font-semibold text-[#bf2600]">{fileError}</p> : null}
              </div>
            </section>

            <aside className="border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:border-l lg:border-t-0">
              <fieldset disabled={saving} className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#dfe1e6] pb-3">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#667085]">
                  Lead properties
                </span>
                <span className="rounded bg-[#e9f2ff] px-2 py-0.5 text-xs font-bold text-[#0c66e4]">
                  Lead
                </span>
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-bold uppercase text-[#6b778c]">
                  Lead type
                </span>
                <div
                  role="radiogroup"
                  aria-label="Lead type"
                  className="grid grid-cols-2 gap-1 rounded border-2 border-[#dfe1e6] bg-white p-1"
                >
                  {LEAD_TYPES.map((type) => {
                    const selected = leadType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => chooseLeadType(type)}
                        className={`h-8 rounded text-sm font-semibold transition ${
                          selected
                            ? "bg-[#e9f2ff] text-[#0c66e4]"
                            : "text-[#42526e] hover:bg-[#f4f5f7]"
                        }`}
                      >
                        {LEAD_TYPE_LABEL[type]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-bold uppercase text-[#6b778c]">
                  {fieldLabel(columns, "product", "Product")}
                  {!productFilter ? <span className="text-[#bf2600]"> *</span> : null}
                </span>
                <TaskSelect
                  label="Product"
                  value={productFilter ?? chosenProduct ?? ""}
                  options={PRODUCT_OPTIONS}
                  placeholder="Select product"
                  disabled={Boolean(productFilter)}
                  buttonClassName={PROPERTY_SELECT_BUTTON_CLASS}
                  menuClassName="min-w-full"
                  renderOption={(option) => {
                    const configured = productColorOptions.find(
                      (candidate) => candidate.label === option.label,
                    );
                    const palette = tableColumnOptionBadgePalette(
                      configured ?? {
                        id: option.label,
                        label: option.label,
                        color: null,
                      },
                    );
                    return (
                      <span
                        className="inline-flex max-w-full min-w-0 items-center truncate rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.025em]"
                        style={{
                          backgroundColor: palette.background,
                          color: palette.foreground,
                        }}
                        title={option.label}
                      >
                        {option.label}
                      </span>
                    );
                  }}
                  onChange={chooseProduct}
                />
              </div>
              <label className="block space-y-1">
                <span className={LABEL_CLASS}>Phone <span className="text-[#bf2600]">*</span></span>
                <input
                  className={INPUT_CLASS}
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Phone number"
                  inputMode="tel"
                  required
                />
              </label>
              <label className="block space-y-1">
                <span className={LABEL_CLASS}>{fieldLabel(columns, "email", "Email")}</span>
                <input
                  className={INPUT_CLASS}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="client@example.com"
                />
              </label>
              {isPersonalLead ? (
                <div className="block space-y-1">
                  <span className={LABEL_CLASS}>
                    {fieldLabel(columns, "event", "Event")}
                  </span>
                  <p className={`${INPUT_CLASS} flex items-center bg-[#f4f5f7] text-[#42526e]`}>
                    {LEAD_TYPE_LABEL.personal}
                  </p>
                  <span className="text-xs text-[#667085]">
                    Personal leads are not tied to an event.
                  </span>
                </div>
              ) : (
              <label className="block space-y-1">
                <span className={LABEL_CLASS}>
                  {fieldLabel(columns, "event", "Event")}
                  <span className="text-[#bf2600]"> *</span>
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
                  {suggestedEvents.map((event) => (
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
              )}
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
                {/* Event lead: the product-specific receiving list configured
                    in Distribute pool — active agents with a positive weight.
                    Personal lead: anyone with lead access, defaulting to you. */}
                {isPersonalLead ? (
                  <TaskSelect
                    label={fieldLabel(columns, "assignee", "Assign to")}
                    value={effectiveAssignee}
                    options={personalAgents.map((person) => ({
                      value: person.email,
                      label:
                        person.email === actorEmail
                          ? `${person.name?.trim() || person.email} (you)`
                          : person.name?.trim() || person.email,
                      keywords: [person.email],
                    }))}
                    placeholder="You"
                    searchable={personalAgents.length > 8}
                    className="w-full"
                    buttonClassName={SELECT_BUTTON_CLASS}
                    menuClassName="max-h-64 min-w-full"
                    onChange={setAssignedToEmail}
                  />
                ) : (
                <TaskSelect
                  label={fieldLabel(columns, "assignee", "Assign to")}
                  value={assignedToEmail}
                  options={productAgents.map((person) => ({
                    value: person.email,
                    label: person.name?.trim() || person.email,
                    keywords: [person.email],
                  }))}
                  placeholder={
                    !product
                      ? "Choose a product first"
                      : distributionAgentsError
                        ? "Could not load agents"
                        : distributionAgents === null
                          ? "Loading agents…"
                          : productAgents.length === 0
                            ? "No agents in Distribute pool"
                            : "Unassigned"
                  }
                  disabled={
                    !product ||
                    distributionAgents === null ||
                    distributionAgentsError ||
                    productAgents.length === 0
                  }
                  searchable={productAgents.length > 8}
                  className="w-full"
                  buttonClassName={SELECT_BUTTON_CLASS}
                  menuClassName="max-h-64 min-w-full"
                  onChange={setAssignedToEmail}
                />
                )}
                {!isPersonalLead && distributionAgentsError ? (
                  <span className="text-xs font-semibold text-rose-700">
                    Could not load Distribute pool agents. Close and reopen this form to retry.
                  </span>
                ) : null}
              </label>
              <div className="block space-y-1">
                <span className={LABEL_CLASS}>Collaborators</span>
                <LeadCollaboratorsPicker
                  emails={collaboratorEmails}
                  people={assignees}
                  onChange={setCollaboratorEmails}
                  buttonClassName="!rounded"
                />
              </div>
              {customColumns.length > 0 ? (
                <div className="space-y-4 border-t border-[#dfe1e6] pt-4">
                  <h3 className={LABEL_CLASS}>Custom fields</h3>
                  {customColumns.map((column) => (
                    <label key={column.id} className="block space-y-1">
                      <span className={LABEL_CLASS}>
                        {column.label}{column.required ? <span className="text-[#bf2600]"> *</span> : null}
                      </span>
                      <CustomLeadField
                        column={column}
                        options={optionsByColumnId.get(column.id) ?? []}
                        value={customValues[column.key]}
                        onChange={(value) => setCustomValue(column.key, value)}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
              <p className="text-xs leading-5 text-[#667085]">
                Phone numbers are normalized automatically. Duplicate phone
                numbers are blocked within the same event, and across personal
                leads.
              </p>
              </fieldset>
            </aside>
          </div>
          {error ? (
            <p
              className="m-4 border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
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
            {saving ? "Creating..." : "Create lead"}
          </button>
        </footer>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { storesInCustomValues } from "@/lib/table-config/system-option-columns";
import {
  LEAD_CLIENT_FIELD_KEYS,
  LEAD_NEED_FIELD_KEYS,
  LEAD_PROPERTY_FIELD_KEYS,
  pickColumnsInOrder,
} from "@/lib/leads/field-layout";
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
  toggleLeadProduct,
  UNKNOWN_LEAD_PRODUCT,
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
  /** Agent ở Account Management — người nhận Personal lead. */
  assignees: { email: string; name: string | null }[];
  /** Agent ở Account Management — danh sách chọn Collaborators. */
  collaboratorRoster: { email: string; name: string | null }[];
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
// Ô chọn nhiều hiện từng giá trị thành nhãn nên phải cao ra được — không cố
// định !h-10 như ô chọn một.
const MULTI_SELECT_BUTTON_CLASS =
  "!rounded !border-2 !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";
const PROPERTY_MULTI_SELECT_BUTTON_CLASS = "!border-[#dfe1e6] !bg-white !shadow-none";
const LABEL_CLASS = "block text-xs font-bold uppercase text-[#6b778c]";
// Thấp vừa đủ để cột trái không phải cuộn; kéo góc để mở rộng khi cần.
const TEXTAREA_CLASS =
  "min-h-[9rem] w-full resize-y rounded border-2 border-[#dfe1e6] bg-white px-3 py-3 text-sm leading-6 text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
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
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim() !== "";
}

function requiredSystemValue(
  key: string,
  values: Record<string, unknown>,
): unknown {
  return values[key];
}

/**
 * Một lựa chọn vẽ thành nhãn màu — cùng kiểu nhãn Product, màu theo màu admin
 * đặt ở Config (chưa đặt thì bảng màu mặc định theo id).
 */
function OptionBadge({ option }: { option: { id: string; label: string; color: string | null } }) {
  const palette = tableColumnOptionBadgePalette(option);
  return (
    <span
      className="inline-flex max-w-full min-w-0 items-center truncate rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.025em]"
      style={{ backgroundColor: palette.background, color: palette.foreground }}
      title={option.label}
    >
      {option.label}
    </span>
  );
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

  const optionById = new Map(options.map((option) => [option.id, option]));
  const renderBadge = (choice: { value: string; label: string }) => (
    <OptionBadge
      option={{
        id: choice.value,
        label: choice.label,
        color: optionById.get(choice.value)?.color ?? null,
      }}
    />
  );

  if (column.type === "dropdown") {
    return (
      <TaskSelect
        label={column.label}
        value={typeof value === "string" ? value : ""}
        renderOption={renderBadge}
        // Cùng kiểu menu với ô chọn nhiều (panel có ô tìm, ✓ sát phải).
        searchable
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

  if (column.type === "multiselect") {
    // Chọn nhiều (vd. Insurance Needs, Contact Method): lưu mảng option id,
    // cùng dạng Import và ô sửa trong bảng/drawer.
    return (
      <TaskSelect
        label={column.label}
        values={Array.isArray(value) ? (value as string[]) : []}
        multi
        summaryLabel={column.label.toLowerCase()}
        showSelectedValues
        renderOption={renderBadge}
        options={options
          .filter((option) => !option.archived_at)
          .map((option) => ({ value: option.id, label: option.label }))}
        placeholder={`Choose ${column.label.toLowerCase()}`}
        className="w-full"
        buttonClassName={MULTI_SELECT_BUTTON_CLASS}
        menuClassName="max-h-64 min-w-full"
        onValuesChange={(next) => onChange(next.length > 0 ? next : null)}
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
          // Cột số lưu số (vd. Age), không lưu chuỗi "71".
          column.type === "number"
            ? event.target.value === ""
              ? null
              : Number(event.target.value)
            : event.target.value,
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
  collaboratorRoster,
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
  // Chọn nhiều product, cùng luật ô Product trên bảng (Unknown đứng một mình).
  // null = chưa đụng: mặc định product của bộ lọc đang xem, không thì Unknown.
  const [chosenProducts, setChosenProducts] = useState<LeadProduct[] | null>(null);
  const products =
    chosenProducts ?? (productFilter ? [productFilter] : [UNKNOWN_LEAD_PRODUCT]);
  /** Product chính — phần tử đầu, như trigger DB suy ra. */
  const product: LeadProduct | null = products[0] ?? null;
  // Người nhận nằm trong pool của MỘT trong các product đã chọn (route kiểm y vậy).
  const productAgents = distributionAgents?.filter((agent) =>
    agent.products.some((candidate) => products.includes(candidate)),
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
  // Trường cố định của mẫu Import (Age, Gender, Ticket #…): cột hệ thống lưu
  // trong custom_values. Luôn có trên form, nằm cùng các trường chính.
  const fixedFieldColumns = useMemo(
    () =>
      columns
        .filter(
          (column) =>
            column.is_system && storesInCustomValues(column) && !column.archived_at,
        )
        .sort((left, right) => left.position - right.position),
    [columns],
  );
  // Thông tin về khách (Age, Gender) ở cột trái cạnh tên; thuộc tính lead
  // (Insurance Needs, Contact Method, Best Time, Ticket #) ở cột phải, sau
  // Product — cùng chỗ với drawer (lib/leads/field-layout.ts).
  const demographicColumns = pickColumnsInOrder(fixedFieldColumns, LEAD_CLIENT_FIELD_KEYS);
  const needFieldColumns = pickColumnsInOrder(fixedFieldColumns, LEAD_NEED_FIELD_KEYS);
  const propertyFieldColumns = pickColumnsInOrder(fixedFieldColumns, LEAD_PROPERTY_FIELD_KEYS);
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

  function chooseProducts(nextValues: string[]) {
    // TaskSelect trả cả danh sách; lấy đúng product vừa bấm rồi áp luật chung
    // (chọn Unknown là bỏ hết; chọn product thật là bỏ Unknown).
    const toggled =
      nextValues.find((value) => !products.includes(value as LeadProduct)) ??
      products.find((current) => !nextValues.includes(current));
    if (!toggled || !isLeadProduct(toggled)) return;
    const next = toggleLeadProduct(products, toggled);
    setChosenProducts(next);
    if (
      assignedToEmail &&
      !distributionAgents?.some(
        (agent) =>
          agent.email === assignedToEmail &&
          agent.products.some((candidate) => next.includes(candidate)),
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
    setChosenProducts(null);
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
        const value = storesInCustomValues(column)
          ? customValues[column.key]
          : requiredSystemValue(column.key, fieldValues);
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
          products,
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
              New {products.map((value) => LEAD_PRODUCT_LABEL[value]).join(" + ")} lead
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

        {/* Màn hình rộng: hai cột cuộn RIÊNG — kéo cột phải (thuộc tính) thì cột
            trái (tên, mô tả) đứng yên. Cột trái hầu như không phải cuộn nên ẩn
            thanh cuộn (vẫn cuộn được). Màn hẹp xếp dọc nên cả thân cuộn chung. */}
        <div className="min-h-0 flex-1 overflow-y-auto lg:flex lg:flex-col lg:overflow-hidden">
          <div className="grid min-h-full lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)]">
            <section className="min-w-0 space-y-4 px-6 py-5 lg:min-h-0 lg:overflow-y-auto lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
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
              {/* Thông tin về khách ở cột trái: liên hệ, rồi Age/Gender. */}
              <div className="grid gap-4 sm:grid-cols-2">
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
              </div>
              {demographicColumns.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {demographicColumns.map((column) => (
                    <label key={column.id} className="block space-y-1">
                      <span className={LABEL_CLASS}>
                        {column.label}
                        {column.required ? <span className="text-[#bf2600]"> *</span> : null}
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
                  rows={5}
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

            <aside className="border-t border-[#dfe1e6] bg-[#f7f8fa] p-4 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
              <fieldset disabled={saving} className="space-y-4">
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
              {isPersonalLead ? (
                <div className="block space-y-1">
                  <span className={LABEL_CLASS}>
                    {fieldLabel(columns, "event", "Event")}
                  </span>
                  <p className={`${INPUT_CLASS} flex items-center bg-[#f4f5f7] text-[#42526e]`}>
                    {LEAD_TYPE_LABEL.personal}
                  </p>
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
              <div>
                <span className="mb-1.5 block text-xs font-bold uppercase text-[#6b778c]">
                  {fieldLabel(columns, "product", "Product")}
                  {!productFilter ? <span className="text-[#bf2600]"> *</span> : null}
                </span>
                <TaskSelect
                  label="Product"
                  values={products}
                  multi
                  summaryLabel="products"
                  showSelectedValues
                  options={PRODUCT_OPTIONS}
                  placeholder="Select product"
                  buttonClassName={PROPERTY_MULTI_SELECT_BUTTON_CLASS}
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
                  onValuesChange={chooseProducts}
                />
              </div>
              {needFieldColumns.map((column) => (
                <label key={column.id} className="block space-y-1">
                  <span className={LABEL_CLASS}>
                    {column.label}
                    {column.required ? <span className="text-[#bf2600]"> *</span> : null}
                  </span>
                  <CustomLeadField
                    column={column}
                    options={optionsByColumnId.get(column.id) ?? []}
                    value={customValues[column.key]}
                    onChange={(value) => setCustomValue(column.key, value)}
                  />
                </label>
              ))}
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
                      label: person.name?.trim() || person.email,
                      keywords: [person.email],
                    }))}
                    placeholder="You"
                    searchable
                    // Ô người giống Agent ở form tạo Task: avatar + tên.
                    personValue
                    className="w-full"
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
                  searchable
                  personValue
                  className="w-full"
                  menuClassName="max-h-64 min-w-full"
                  onChange={setAssignedToEmail}
                />
                )}
                {/* Ô người chỉ hiện "Unassigned" khi bị khoá, nên nói lý do ở dưới. */}
                {!isPersonalLead && distributionAgentsError ? (
                  <span className="text-xs font-semibold text-rose-700">
                    Could not load Distribute pool agents. Close and reopen this form to retry.
                  </span>
                ) : !isPersonalLead && distributionAgents === null ? (
                  <span className="text-xs text-[#667085]">Loading agents…</span>
                ) : !isPersonalLead && productAgents.length === 0 ? (
                  <span className="text-xs font-semibold text-[#974f0c]">
                    No agents in the Distribute pool for these products.
                  </span>
                ) : null}
              </label>
              <div className="block space-y-1">
                <span className={LABEL_CLASS}>Collaborators</span>
                <LeadCollaboratorsPicker
                  emails={collaboratorEmails}
                  people={collaboratorRoster}
                  onChange={setCollaboratorEmails}
                />
              </div>
              {propertyFieldColumns.map((column) => (
                <label key={column.id} className="block space-y-1">
                  <span className={LABEL_CLASS}>
                    {column.label}
                    {column.required ? <span className="text-[#bf2600]"> *</span> : null}
                  </span>
                  <CustomLeadField
                    column={column}
                    options={optionsByColumnId.get(column.id) ?? []}
                    value={customValues[column.key]}
                    onChange={(value) => setCustomValue(column.key, value)}
                  />
                </label>
              ))}
              <div className="block space-y-1">
                <span className={LABEL_CLASS}>
                  {fieldLabel(columns, "status", "Status")}
                </span>
                <p
                  className={`${INPUT_CLASS} flex items-center bg-[#f4f5f7] text-[#42526e]`}
                >
                  {selectedStatusLabel}
                </p>
              </div>
              {/* Cột tự thêm hiện như mọi trường khác, không tách nhóm riêng. */}
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

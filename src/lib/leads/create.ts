import { normalizePhone } from "./import-parse";
import { parseCollaboratorEmails } from "./collaborators";
import { isLeadType, isPersonalLeadEventName, type LeadType } from "./lead-type";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const MAX_CUSTOM_FIELDS = 100;
const MAX_CUSTOM_KEY_LENGTH = 120;

export type CreateLeadInput = {
  fullName: string | null;
  phone: string;
  email: string | null;
  fubLink: string | null;
  description: string | null;
  eventId: string | null;
  /**
   * A typed event name. The dialog lets someone name an event that does not
   * exist yet, and the route finds or creates it — so a lead never waits on
   * someone remembering to register the event first, while the per-event
   * report keeps working because leads still point at a real row.
   */
  eventName: string | null;
  /**
   * Chỉ dialog Add lead gửi. null = client cũ: event tuỳ chọn, gán như trước.
   * "personal" thì không có event và bắt buộc có một Agent;
   * "event" thì bắt buộc có event — xem lib/leads/lead-type.ts.
   */
  leadType: LeadType | null;
  statusId: string | null;
  assignedToEmail: string | null;
  collaboratorEmails: string[];
  customValues: Record<string, unknown>;
  clientRequestId: string | null;
};

export type CreateLeadParseResult =
  | { ok: true; value: CreateLeadInput }
  | { ok: false; error: string };

function optionalText(value: unknown, label: string, maxLength: number): string | null | { error: string } {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return { error: `${label} must be text.` };
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) return { error: `${label} is too long.` };
  return trimmed;
}

function optionalEmail(value: unknown, label: string): string | null | { error: string } {
  const parsed = optionalText(value, label, 320) as string | null | { error: string };
  if (typeof parsed === "object" && parsed !== null && "error" in parsed) return parsed;
  if (parsed === null) return null;
  if (!EMAIL_RE.test(parsed)) return { error: `${label} must be a valid email address.` };
  return parsed.toLowerCase();
}

function optionalUuid(value: unknown, label: string): string | null | { error: string } {
  const parsed = optionalText(value, label, 80) as string | null | { error: string };
  if (typeof parsed === "object" && parsed !== null && "error" in parsed) return parsed;
  if (parsed === null) return null;
  if (!UUID_RE.test(parsed)) return { error: `${label} must be a valid UUID.` };
  return parsed;
}

function parseCustomValues(value: unknown):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "custom_values must be an object." };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CUSTOM_FIELDS) {
    return { ok: false, error: `A lead can have at most ${MAX_CUSTOM_FIELDS} custom fields.` };
  }
  const customValues: Record<string, unknown> = {};
  for (const [key, fieldValue] of entries) {
    const trimmedKey = key.trim();
    if (!trimmedKey || trimmedKey.length > MAX_CUSTOM_KEY_LENGTH) {
      return { ok: false, error: "Custom field names must be between 1 and 120 characters." };
    }
    // Mảng chuỗi = cột chọn nhiều (option id), vd. Insurance Needs.
    const isOptionList =
      Array.isArray(fieldValue) &&
      fieldValue.length <= MAX_CUSTOM_FIELDS &&
      fieldValue.every((item) => typeof item === "string" && item.length <= 200);
    if (
      fieldValue !== null &&
      !isOptionList &&
      typeof fieldValue !== "string" &&
      typeof fieldValue !== "number" &&
      typeof fieldValue !== "boolean"
    ) {
      return { ok: false, error: `Custom field \"${trimmedKey}\" has an unsupported value.` };
    }
    if (typeof fieldValue === "string" && fieldValue.length > 10_000) {
      return { ok: false, error: `Custom field \"${trimmedKey}\" is too long.` };
    }
    customValues[trimmedKey] = fieldValue;
  }
  return { ok: true, value: customValues };
}

export function parseCreateLeadInput(body: unknown): CreateLeadParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be an object." };
  }
  const input = body as Record<string, unknown>;
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "A valid phone number is required." };

  const fullName = optionalText(input.full_name, "Full name", 200);
  if (fullName !== null && typeof fullName === "object") return { ok: false, error: fullName.error };
  const email = optionalEmail(input.email, "Email");
  if (email !== null && typeof email === "object") return { ok: false, error: email.error };
  const fubLink = optionalText(input.fub_link, "FUB link", 500);
  if (fubLink !== null && typeof fubLink === "object") return { ok: false, error: fubLink.error };
  const description = optionalText(input.description, "Description", 10_000);
  if (description !== null && typeof description === "object") return { ok: false, error: description.error };
  const eventId = optionalUuid(input.event_id, "Event");
  if (eventId !== null && typeof eventId === "object") return { ok: false, error: eventId.error };
  const typedEventName = optionalText(input.event_name, "Event name", 200);
  if (typedEventName !== null && typeof typedEventName === "object") return { ok: false, error: typedEventName.error };
  if (input.lead_type !== undefined && input.lead_type !== null && !isLeadType(input.lead_type)) {
    return { ok: false, error: "Invalid lead type." };
  }
  const leadType = input.lead_type ?? null;
  // "Personal Lead" gõ vào ô Event là cách đánh dấu cũ, không phải tên event.
  const eventName =
    leadType === "personal" || isPersonalLeadEventName(typedEventName) ? null : typedEventName;
  const resolvedEventId = leadType === "personal" ? null : eventId;
  if (leadType === "event" && !resolvedEventId && !eventName) {
    return {
      ok: false,
      error: "An event lead needs an event name. For a lead without an event, choose Personal lead.",
    };
  }
  const statusId = optionalUuid(input.status_id, "Status");
  if (statusId !== null && typeof statusId === "object") return { ok: false, error: statusId.error };
  const assignedToEmail = optionalEmail(input.assigned_to_email, "Agent");
  if (assignedToEmail !== null && typeof assignedToEmail === "object") return { ok: false, error: assignedToEmail.error };
  const collaboratorEmails = parseCollaboratorEmails(input.collaborator_emails);
  if (!collaboratorEmails.ok) return collaboratorEmails;
  const clientRequestId = optionalUuid(input.client_request_id, "Client request ID");
  if (clientRequestId !== null && typeof clientRequestId === "object") return { ok: false, error: clientRequestId.error };
  const customValues = parseCustomValues(input.custom_values);
  if (!customValues.ok) return customValues;

  return {
    ok: true,
    value: {
      fullName,
      phone,
      email,
      fubLink,
      description,
      eventId: resolvedEventId,
      eventName,
      leadType,
      statusId,
      assignedToEmail,
      collaboratorEmails: collaboratorEmails.emails,
      customValues: customValues.value,
      clientRequestId,
    },
  };
}

export type NewLeadRowInput = {
  eventId: string | null;
  statusId: string | null;
  fullName: string | null;
  /** Add lead luôn có số; Import theo mẫu thì có thể trống ("có gì ghi nấy"). */
  phone: string | null;
  email: string | null;
  /** Optional for imports, which may not provide a FUB URL. */
  fubLink?: string | null;
  description?: string | null;
  collaboratorEmails?: string[];
  /** Personal leads are created with their required Agent already assigned. */
  assignedToEmail?: string | null;
  customValues: Record<string, unknown>;
  /** Người bấm nút — dùng cho cả `created_by_email` lẫn `updated_by_email`. */
  actorEmail: string;
  /** Chỉ Create có; Import không dùng khoá idempotency theo dòng. */
  clientRequestId?: string | null;
  now?: Date;
};

/**
 * Dựng hàng `leads` cho một lead MỚI — dùng chung cho Add lead và Import.
 *
 * Lý do phải có hàm này thay vì mỗi route tự viết payload: hai cửa đã lệch nhau
 * ở đúng chỗ dễ lệch nhất. Add lead đặt status mặc định "New", Import không đặt
 * gì — **91/121 lead trong DB không có status**, cột Status trống và bộ lọc theo
 * status không tìm thấy chúng. Import cũng bỏ quên `updated_by_email`.
 *
 * Gom về một chỗ thì một trường thêm vào là thêm cho CẢ HAI cửa, không phải nhớ
 * sửa hai nơi.
 *
 * Event leads bắt đầu trong pool, nên `assigned_*` để trống. Personal leads
 * phải có Agent ngay từ lúc insert; lịch sử tạo lead đó được trigger DB ghi
 * với from_email = null, thay vì gọi RPC rồi tự ghi "từ X sang X".
 */
export function buildNewLeadRow(input: NewLeadRowInput): Record<string, unknown> {
  const actor = input.actorEmail.trim().toLowerCase();
  const assignedToEmail = input.assignedToEmail?.trim().toLowerCase() || null;
  const nowIso = (input.now ?? new Date()).toISOString();
  return {
    event_id: input.eventId,
    status_id: input.statusId,
    full_name: input.fullName,
    phone: input.phone,
    email: input.email,
    fub_link: input.fubLink ?? null,
    description: input.description ?? null,
    collaborator_emails: input.collaboratorEmails ?? [],
    assigned_to_email: assignedToEmail,
    assigned_at: assignedToEmail ? nowIso : null,
    assigned_by_email: assignedToEmail ? actor : null,
    custom_values: input.customValues,
    created_by_email: actor,
    updated_by_email: actor,
    updated_at: nowIso,
    ...(input.clientRequestId ? { client_request_id: input.clientRequestId } : {}),
  };
}

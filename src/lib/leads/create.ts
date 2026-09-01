import { normalizePhone } from "./import-parse";
import { isLeadProduct, type LeadProduct } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const MAX_CUSTOM_FIELDS = 100;
const MAX_CUSTOM_KEY_LENGTH = 120;

export type CreateLeadInput = {
  product: LeadProduct;
  fullName: string | null;
  phone: string;
  email: string | null;
  eventId: string | null;
  /**
   * A typed event name. The dialog lets someone name an event that does not
   * exist yet, and the route finds or creates it — so a lead never waits on
   * someone remembering to register the event first, while the per-event
   * report keeps working because leads still point at a real row.
   */
  eventName: string | null;
  statusId: string | null;
  assignedToEmail: string | null;
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
    if (
      fieldValue !== null &&
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
  if (!isLeadProduct(input.product)) return { ok: false, error: "Unknown product." };

  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "A valid phone number is required." };

  const fullName = optionalText(input.full_name, "Full name", 200);
  if (fullName !== null && typeof fullName === "object") return { ok: false, error: fullName.error };
  const email = optionalEmail(input.email, "Email");
  if (email !== null && typeof email === "object") return { ok: false, error: email.error };
  const eventId = optionalUuid(input.event_id, "Event");
  if (eventId !== null && typeof eventId === "object") return { ok: false, error: eventId.error };
  const eventName = optionalText(input.event_name, "Event name", 200);
  if (eventName !== null && typeof eventName === "object") return { ok: false, error: eventName.error };
  const statusId = optionalUuid(input.status_id, "Status");
  if (statusId !== null && typeof statusId === "object") return { ok: false, error: statusId.error };
  const assignedToEmail = optionalEmail(input.assigned_to_email, "Assignee");
  if (assignedToEmail !== null && typeof assignedToEmail === "object") return { ok: false, error: assignedToEmail.error };
  const clientRequestId = optionalUuid(input.client_request_id, "Client request ID");
  if (clientRequestId !== null && typeof clientRequestId === "object") return { ok: false, error: clientRequestId.error };
  const customValues = parseCustomValues(input.custom_values);
  if (!customValues.ok) return customValues;

  return {
    ok: true,
    value: {
      product: input.product,
      fullName,
      phone,
      email,
      eventId,
      eventName,
      statusId,
      assignedToEmail,
      customValues: customValues.value,
      clientRequestId,
    },
  };
}

/**
 * Which product a create/import dialog will actually write.
 *
 * Returns null when the answer is not known yet and the dialog must ask. The
 * screen merged P&C and Health into one list, so "no product filter" is the
 * normal state — and both dialogs used to fall back to `"health"` there,
 * silently filing a P&C campaign as Health with nothing on screen saying so.
 * A misfiled lead is worse than one extra click.
 */
export function resolveDialogProduct(
  productFilter: LeadProduct | null,
  chosen: LeadProduct | null
): LeadProduct | null {
  return productFilter ?? chosen;
}

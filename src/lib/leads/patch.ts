import { normalizePhone } from "./import-parse";
import { isLeadProduct } from "./types";

/**
 * The system fields the table lets someone edit in place. Everything else on a
 * lead is either derived (attempts, last contact — only the interaction RPC
 * writes those), an audit trail (created_by, updated_at), or has a route of its
 * own with rules a plain column write would skip: assignment keeps a history,
 * and archiving is a different action entirely.
 */
export const EDITABLE_LEAD_FIELDS = [
  "full_name",
  "phone",
  "email",
  "product",
  "status_id",
  "next_follow_up_at",
] as const;

/** Not a column: the route turns a name into an event id (find-or-create). */
export const EVENT_NAME_FIELD = "event_name";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LeadPatchResult =
  | {
      ok: true;
      /** Column writes, ready for the update. */
      patch: Record<string, unknown>;
      /** Present only when the caller sent event_name; "" means clear it. */
      eventName?: string | null;
      customValues?: Record<string, unknown>;
    }
  | { ok: false; error: string };

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Validates one inline edit. Unknown keys are refused rather than ignored: a
 * typo in a field name would otherwise look like a save that worked.
 */
export function buildLeadPatch(body: unknown): LeadPatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Nothing to update." };
  }
  const input = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  let eventName: string | null | undefined;
  let customValues: Record<string, unknown> | undefined;

  for (const [key, value] of Object.entries(input)) {
    if (key === EVENT_NAME_FIELD) {
      eventName = text(value);
      continue;
    }
    // `products` is an internal multi-product write used by the Product cell.
    // It is intentionally not a table-config column, so it must not be sent
    // to the metadata validator as if an admin had created a column with that
    // key. An empty array is the valid "not classified yet" state.
    if (key === "products") {
      if (
        !Array.isArray(value) ||
        value.some((product) => !isLeadProduct(product))
      ) {
        return { ok: false, error: "Unknown product." };
      }
      patch.products = [...new Set(value)];
      continue;
    }
    if (key === "custom_values") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "custom_values must be an object." };
      }
      customValues = value as Record<string, unknown>;
      continue;
    }
    if (!(EDITABLE_LEAD_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `${key} cannot be edited here.` };
    }

    switch (key) {
      case "full_name":
        patch.full_name = text(value);
        break;
      case "phone": {
        // Same normaliser Create uses. Without it an inline edit could store
        // "(714) 555-0123" beside a created "7145550123", and the duplicate
        // check plus the digits-only search both compare raw strings.
        const raw = text(value);
        if (raw === null) {
          patch.phone = null;
          break;
        }
        const phone = normalizePhone(raw);
        if (!phone) return { ok: false, error: "Enter a valid phone number." };
        patch.phone = phone;
        break;
      }
      case "email": {
        const email = text(value)?.toLowerCase() ?? null;
        if (email && !email.includes("@")) {
          return { ok: false, error: "Enter a valid email address." };
        }
        patch.email = email;
        break;
      }
      case "product":
        if (value === null || value === undefined || value === "") {
          patch.product = null;
          break;
        }
        if (!isLeadProduct(value)) return { ok: false, error: "Unknown product." };
        patch.product = value;
        break;
      case "status_id": {
        const statusId = text(value);
        if (statusId && !UUID_RE.test(statusId)) {
          return { ok: false, error: "Invalid status." };
        }
        patch.status_id = statusId;
        break;
      }
      case "next_follow_up_at": {
        const raw = text(value);
        if (raw === null) {
          patch.next_follow_up_at = null;
          break;
        }
        const parsed = Date.parse(raw);
        if (!Number.isFinite(parsed)) {
          return { ok: false, error: "Enter a valid follow-up date." };
        }
        patch.next_follow_up_at = new Date(parsed).toISOString();
        break;
      }
    }
  }

  if (
    Object.keys(patch).length === 0 &&
    eventName === undefined &&
    customValues === undefined
  ) {
    return { ok: false, error: "Nothing to update." };
  }
  return { ok: true, patch, eventName, customValues };
}

export type FollowUpCheckInput = {
  /** Status kind the lead ends up with; null = no status, or status cleared. */
  nextStatusKind: "open" | "scheduled" | "won" | "lost" | null;
  /** Follow-up the lead ends up with, before any clearing rule is applied. */
  nextFollowUpAt: string | null;
  /** True when this request explicitly sent a follow-up value. */
  followUpTouched: boolean;
};

export type FollowUpCheckResult =
  | { ok: true; clearFollowUp: boolean }
  | { ok: false; error: string };

/**
 * The status/follow-up invariant log_lead_interaction_atomic enforces, applied
 * to a partial edit. Both directions matter:
 *
 * - a `scheduled` status with no date is a promise the alert engine can never
 *   see come due, so it sits as a permanent red flag;
 * - a date on any other status is a promise nobody made — resolveLeadAlerts
 *   reads next_follow_up_at regardless of status, so it would raise an overdue
 *   alert for a call no one owes.
 *
 * Moving OFF a scheduled status clears the pending date rather than refusing:
 * marking a lead Won while a call-back is outstanding is normal, and keeping
 * the date would leave a Won lead flagged overdue.
 */
export function checkFollowUpInvariant(
  input: FollowUpCheckInput
): FollowUpCheckResult {
  const scheduled = input.nextStatusKind === "scheduled";
  if (scheduled && !input.nextFollowUpAt) {
    return {
      ok: false,
      error: "That status needs a follow-up date. Open the lead to log it.",
    };
  }
  if (!scheduled && input.nextFollowUpAt) {
    // Someone is setting a date right now on a status that cannot carry one.
    if (input.followUpTouched) {
      return {
        ok: false,
        error: "Only a call-back status can carry a follow-up date.",
      };
    }
    // The date is left over from a previous scheduled status; drop it.
    return { ok: true, clearFollowUp: true };
  }
  return { ok: true, clearFollowUp: false };
}

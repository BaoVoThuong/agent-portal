export const LEAD_PRODUCTS = ["pc", "health"] as const;
export type LeadProduct = (typeof LEAD_PRODUCTS)[number];

export function isLeadProduct(value: unknown): value is LeadProduct {
  return (
    typeof value === "string" &&
    (LEAD_PRODUCTS as readonly string[]).includes(value)
  );
}

export function toLeadProduct(value: unknown): LeadProduct {
  return isLeadProduct(value) ? value : "pc";
}

/** Cái máy đọc. Nhãn hiển thị do admin đặt và không ảnh hưởng logic. */
export const STATUS_KINDS = ["open", "scheduled", "won", "lost"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export function isStatusKind(value: unknown): value is StatusKind {
  return (
    typeof value === "string" &&
    (STATUS_KINDS as readonly string[]).includes(value)
  );
}

export type LeadStatus = {
  id: string;
  product: LeadProduct;
  label: string;
  color: string | null;
  position: number;
  kind: StatusKind;
  archived_at: string | null;
};

export type LeadInteractionType = {
  id: string;
  label: string;
  color: string | null;
  position: number;
  counts_as_contact: boolean;
  archived_at: string | null;
};

/** Minimal interaction shape embedded in the Lead List response. */
export type LeadInteractionPreview = {
  id: string;
  type_id: string;
  occurred_at: string;
};

/** Bounded list payload; the detail drawer remains the full audit trail. */
export const LEAD_INTERACTION_HISTORY_LIMIT = 50;

export type LeadRow = {
  id: string;
  display_number: number;
  product: LeadProduct;
  event_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  assigned_to_email: string | null;
  assigned_at: string | null;
  assigned_by_email: string | null;
  status_id: string | null;
  first_contacted_at: string | null;
  last_contacted_at: string | null;
  contact_attempt_count: number;
  next_follow_up_at: string | null;
  closed_at: string | null;
  created_by_email: string;
  created_at: string;
  updated_by_email: string | null;
  updated_at: string;
  custom_values: Record<string, unknown>;
  archived_at: string | null;
  /** Newest first; bounded for the list while the drawer exposes full history. */
  interaction_history?: LeadInteractionPreview[];
};

export type LeadInteraction = LeadInteractionPreview & {
  lead_id: string;
  status_id: string | null;
  note: string | null;
  actor_email: string;
  follow_up_at: string | null;
  created_at: string;
};

export type LeadAlertSettings = {
  product: LeadProduct;
  no_contact_hours: number;
  stale_days: number;
  max_attempts: number;
};

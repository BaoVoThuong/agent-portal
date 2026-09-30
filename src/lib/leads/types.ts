/**
 * Thứ tự này là thứ tự cố định mà trigger lead_sync_primary_product dùng để
 * chọn `product` = phần tử đầu, và là thứ tự tab trong Distribute pool.
 */
export const LEAD_PRODUCTS = ["pc", "health", "life", "unknown"] as const;
export type LeadProduct = (typeof LEAD_PRODUCTS)[number];

export const LEAD_PRODUCT_LABEL: Record<LeadProduct, string> = {
  pc: "P&C",
  health: "Health",
  life: "Life",
  unknown: "Unknown",
};

/**
 * "Chưa biết khách quan tâm gì" (2026-09-29). Nó thay cho mảng rỗng trước đây:
 * lead không có product nào thì DB tự ghi thành Unknown, nên chỉ còn MỘT cách
 * nói "chưa biết" và lead đó có pool riêng để chia. Unknown luôn đứng một mình.
 */
export const UNKNOWN_LEAD_PRODUCT = "unknown" satisfies LeadProduct;

export function isLeadProduct(value: unknown): value is LeadProduct {
  return (
    typeof value === "string" &&
    (LEAD_PRODUCTS as readonly string[]).includes(value)
  );
}

/** Một giá trị cho mỗi product, theo đúng thứ tự LEAD_PRODUCTS. */
export function byLeadProduct<T>(make: (product: LeadProduct) => T): Record<LeadProduct, T> {
  return Object.fromEntries(
    LEAD_PRODUCTS.map((product) => [product, make(product)])
  ) as Record<LeadProduct, T>;
}

/**
 * Bản TS của luật trong trigger lead_sync_primary_product, để UI hiện đúng thứ
 * DB sẽ lưu ngay lúc bấm: bỏ trùng, xếp theo LEAD_PRODUCTS, có product thật thì
 * bỏ Unknown, không còn gì thì là Unknown.
 */
export function normalizeLeadProducts(products: readonly LeadProduct[]): LeadProduct[] {
  const known = LEAD_PRODUCTS.filter(
    (product) => product !== UNKNOWN_LEAD_PRODUCT && products.includes(product)
  );
  return known.length > 0 ? known : [UNKNOWN_LEAD_PRODUCT];
}

/**
 * Bấm một product trong ô Product. Chọn Unknown là bỏ mọi product khác; chọn
 * một product thật là bỏ Unknown. Bỏ tick product cuối cùng thì về Unknown.
 */
export function toggleLeadProduct(
  current: readonly LeadProduct[],
  product: LeadProduct
): LeadProduct[] {
  if (product === UNKNOWN_LEAD_PRODUCT) return [UNKNOWN_LEAD_PRODUCT];
  return normalizeLeadProducts(
    current.includes(product)
      ? current.filter((item) => item !== product)
      : [...current, product]
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
  /**
   * No product: the P&C and Health sets were seeded with the same seven labels
   * and never diverged, so one list serves both. A status is a stage of a phone
   * conversation, not a property of the policy behind it.
   */
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

/** The table shows only the three newest interactions; the drawer owns history. */
export const LEAD_INTERACTION_HISTORY_LIMIT = 3;

export type LeadRow = {
  id: string;
  display_number: number;
  /**
   * Product "chính" — phần tử đầu của `products`, do trigger trong DB suy ra.
   * Từ rollout 2026-09-29 không còn null: chưa biết thì là "unknown". Kiểu vẫn
   * giữ null cho dòng đọc về từ trước rollout.
   */
  product: LeadProduct | null;
  /** Một lead có thể mang nhiều product; chưa biết thì là ["unknown"]. */
  products: LeadProduct[];
  event_id: string | null;
  /** Joined from lead_events. The uuid identifies; the name is what people read. */
  event_name?: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  /** Cùng tên với `tasks.fub_link`: hai màn hình mở cùng một loại hồ sơ. */
  fub_link: string | null;
  /** Free-form context captured when the lead is created. */
  description?: string | null;
  assigned_to_email: string | null;
  /** People collaborating on this lead; independent from the single Agent. */
  collaborator_emails?: string[];
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

/** A regular discussion message in an Event Lead's shared activity feed. */
export type LeadComment = {
  id: string;
  lead_id: string;
  parent_id: string | null;
  author_email: string;
  body: string;
  client_request_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type LeadAttachment = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
  url: string;
};

export type LeadAlertSettings = {
  product: LeadProduct;
  no_contact_hours: number;
  stale_days: number;
  max_attempts: number;
};

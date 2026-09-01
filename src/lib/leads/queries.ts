import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveLeadAlerts, type LeadAlert } from "./alerts";
import { settingsForLead, type LeadAlertSettingsByProduct } from "./overview";
import type { LeadActor } from "./access";
import {
  LEAD_INTERACTION_HISTORY_LIMIT,
  isLeadProduct,
  type LeadAlertSettings,
  type LeadInteractionPreview,
  type LeadInteractionType,
  type LeadProduct,
  type LeadRow,
  type LeadStatus,
} from "./types";

export const LEAD_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export type LeadListParams = {
  /** Danh sách id cụ thể; realtime dùng để vá vài dòng thay vì kéo cả danh sách. */
  ids?: unknown;
  product?: unknown;
  assigned_to?: unknown;
  event_id?: unknown;
  status_id?: unknown;
  alert?: unknown;
  limit?: unknown;
  offset?: unknown;
};

export type LeadListFilter = {
  /** null = every product. Event Leads is one list; product is a filter. */
  product: LeadProduct | null;
  /**
   * Emails the rows may be assigned to. null = no owner restriction, which is
   * a manager. An empty array would mean "no rows", so the two cannot share a
   * representation.
   */
  ownerEmails: string[] | null;
  eventId: string | null;
  statusId: string | null;
  /** null = không giới hạn theo id. */
  ids: string[] | null;
  alert: LeadAlert | null;
  limit: number;
  offset: number;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function count(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(typeof value === "string" ? value : "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) return fallback;
  return parsed;
}

function toLeadAlert(value: unknown): LeadAlert | null {
  return typeof value === "string" && [
    "never_contacted", "stale", "follow_up_overdue", "exhausted",
  ].includes(value) ? value as LeadAlert : null;
}

export function buildLeadListFilter(
  actor: LeadActor,
  params: LeadListParams,
  /**
   * Emails this worker may see, from resolveLeadOwnerEmails: their own plus the
   * agents they assist. null for a manager. Defaulting to the actor's own email
   * keeps the old single-owner behaviour for any caller that has not resolved
   * membership yet — narrower, never wider.
   */
  ownerEmails?: string[] | null
): LeadListFilter {
  const requested = text(params.assigned_to);
  const scoped =
    ownerEmails !== undefined
      ? ownerEmails
      : [actor.email.trim().toLowerCase()];
  return {
    // Deliberately NOT toLeadProduct(): that helper falls back to "pc" for
    // anything unrecognised, which is right for a URL that names a product but
    // wrong here, where "no product given" means "show me all of them". Using
    // it made the merged list silently filter to P&C and show nothing.
    product: isLeadProduct(params.product) ? params.product : null,
    ownerEmails: actor.isManager
      ? requested
        ? [requested.toLowerCase()]
        : null
      : scoped,
    eventId: text(params.event_id),
    statusId: text(params.status_id),
    ids: (() => {
      const raw = String(params.ids ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      // Trần 25 khớp với trần bên broadcast: quá số đó thì vá từng dòng không
      // còn rẻ hơn tải lại cả danh sách.
      return raw.length > 0 ? raw.slice(0, 25) : null;
    })(),
    alert: toLeadAlert(params.alert),
    limit: count(params.limit, LEAD_PAGE_SIZE, MAX_PAGE_SIZE),
    offset: count(params.offset, 0, 1_000_000) || 0,
  };
}

const LEAD_COLUMNS =
  "id,display_number,product,products,event_id,full_name,phone,email," +
  "assigned_to_email,assigned_at,assigned_by_email,status_id," +
  "first_contacted_at,last_contacted_at,contact_attempt_count," +
  "next_follow_up_at,closed_at,created_by_email,created_at," +
  "updated_by_email,updated_at,custom_values,archived_at";
// event_id is a uuid. Every screen wants the event's NAME, so it is embedded
// here rather than left to each caller: the list rendered the raw uuid in the
// Event column, and the filter dropdown offered uuids as its choices.
const LEAD_LIST_COLUMNS =
  `${LEAD_COLUMNS},lead_events(name),lead_interactions(id,type_id,occurred_at)`;

export type LeadAlertContext = {
  settingsByProduct: LeadAlertSettingsByProduct;
  /** Won/lost status ids: a finished lead raises no alert. */
  terminalStatusIds: string[];
};

/** The two lookups the alert filter needs, fetched once for a whole listing. */
export async function fetchLeadAlertContext(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<LeadAlertContext> {
  const [settings, statuses] = await Promise.all([
    fetchLeadAlertSettings(supabase),
    supabase.from("lead_statuses").select("id").is("archived_at", null).in("kind", ["won", "lost"]),
  ]);
  if (statuses.error) throw new Error(statuses.error.message);
  return {
    settingsByProduct: settings,
    terminalStatusIds: (statuses.data ?? []).map((row) => (row as { id: string }).id),
  };
}

export async function fetchLeadsPage(
  actor: LeadActor,
  params: LeadListParams,
  supabase: SupabaseClient = getSupabaseAdmin(),
  ownerEmails?: string[] | null,
  /**
   * Nạp sẵn từ fetchAllLeads. Trước đây hai truy vấn này chạy BÊN TRONG mỗi
   * trang, nên một danh sách 1.000 lead lọc theo cảnh báo tốn 5 lần đọc ngưỡng
   * và 5 lần đọc status kết thúc — cùng một câu trả lời, lấy đi lấy lại.
   */
  alertContext?: LeadAlertContext
): Promise<{
  rows: LeadRow[];
  total: number;
  filter: LeadListFilter;
  alertSettingsByProduct: LeadAlertSettingsByProduct | null;
}> {
  const filter = buildLeadListFilter(actor, params, ownerEmails);
  let alertSettings: LeadAlertSettings | null = null;
  let alertSettingsByProduct: LeadAlertSettingsByProduct | null = null;
  let terminalStatusIds: string[] = [];
  if (filter.alert) {
    const context = alertContext ?? (await fetchLeadAlertContext(supabase));
    alertSettingsByProduct = context.settingsByProduct;
    terminalStatusIds = context.terminalStatusIds;
    const inScope = filter.product
      ? [alertSettingsByProduct[filter.product]]
      : [alertSettingsByProduct.pc, alertSettingsByProduct.health];
    // SQL chỉ là bộ lọc thô và phải là TẬP CHA của câu trả lời thật: lấy ngưỡng
    // lỏng nhất trong các product đang xem, rồi resolveLeadAlerts chốt lại ở
    // Node. Lấy ngưỡng chặt hơn là âm thầm giấu mất lead đáng lẽ phải hiện.
    alertSettings = {
      product: filter.product ?? "health",
      no_contact_hours: Math.min(...inScope.map((row) => row.no_contact_hours)),
      stale_days: Math.min(...inScope.map((row) => row.stale_days)),
      max_attempts: Math.min(...inScope.map((row) => row.max_attempts)),
    };
  }
  // `count: "exact"` chạy một COUNT(*) trên toàn bộ tập đã lọc. Trước đây mỗi
  // trang đều xin nó, nên một danh sách 5 trang trả lời cùng một câu hỏi năm
  // lần. Chỉ trang đầu cần, các trang sau mang theo con số đó.
  let query = supabase
    .from("leads")
    .select(LEAD_LIST_COLUMNS, filter.offset === 0 ? { count: "exact" } : {})
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(filter.offset, filter.offset + filter.limit - 1);

  // `contains` = `products @> array[...]`, dùng index GIN. Lead mang cả hai
  // product phải hiện ở CẢ HAI bộ lọc, nên không thể so bằng cột `product`.
  if (filter.product) query = query.contains("products", [filter.product]);
  if (filter.ownerEmails) query = query.in("assigned_to_email", filter.ownerEmails);
  if (filter.ids) query = query.in("id", filter.ids);
  if (filter.eventId) query = query.eq("event_id", filter.eventId);
  if (filter.statusId) query = query.eq("status_id", filter.statusId);
  if (filter.alert) {
    const now = new Date();
    query = query
      .not("assigned_to_email", "is", null)
      .not("assigned_at", "is", null);
    if (terminalStatusIds.length > 0) {
      query = query.or(`status_id.is.null,status_id.not.in.(${terminalStatusIds.join(",")})`);
    }
    if (filter.alert === "never_contacted") {
      query = query.is("first_contacted_at", null).lt(
        "assigned_at",
        new Date(now.getTime() - alertSettings!.no_contact_hours * 3_600_000).toISOString()
      );
    } else if (filter.alert === "stale") {
      query = query
        .not("first_contacted_at", "is", null)
        .not("last_contacted_at", "is", null)
        .lt("last_contacted_at", new Date(now.getTime() - alertSettings!.stale_days * 86_400_000).toISOString());
    } else if (filter.alert === "follow_up_overdue") {
      query = query.lt("next_follow_up_at", now.toISOString());
    } else {
      query = query.gte("contact_attempt_count", alertSettings!.max_attempts);
    }
  }

  const { data, error, count: total } = await query
    // PostgREST applies the embedded ordering/limit for every lead, avoiding
    // an N+1 history request or an unbounded history payload for the table.
    .order("occurred_at", {
      ascending: false,
      referencedTable: "lead_interactions",
    })
    .limit(LEAD_INTERACTION_HISTORY_LIMIT, {
      referencedTable: "lead_interactions",
    });
  if (error) throw new Error(error.message);
  return {
    rows: (data ?? []).map(toLeadRowWithInteractionHistory),
    total: total ?? 0,
    filter,
    alertSettingsByProduct,
  };
}

function toLeadRowWithInteractionHistory(row: unknown): LeadRow {
  const source = row as LeadRow & {
    lead_interactions?: LeadInteractionPreview[] | null;
    lead_events?: { name?: string | null } | null;
  };
  const { lead_interactions, lead_events, ...lead } = source;
  const products = Array.isArray(source.products)
    ? source.products.filter(isLeadProduct)
    : isLeadProduct(source.product)
      ? [source.product]
      : [];
  return {
    ...lead,
    product: isLeadProduct(source.product) ? source.product : products[0] ?? null,
    products,
    event_name: lead_events?.name?.trim() || null,
    interaction_history: Array.isArray(lead_interactions)
      ? lead_interactions
      : [],
  };
}

/**
 * The Lead List has the same continuous-scroll interaction as the Task List.
 * Keep the database request bounded per round trip, but assemble every row
 * before rendering so the UI never exposes numbered pages or Next/Previous.
 */
export async function fetchAllLeads(
  actor: LeadActor,
  params: LeadListParams,
  supabase: SupabaseClient = getSupabaseAdmin(),
  ownerEmails?: string[] | null
): Promise<{ rows: LeadRow[]; total: number }> {
  const rows: LeadRow[] = [];
  let offset = 0;
  let total = 0;
  let settingsByProduct: LeadAlertSettingsByProduct | null = null;
  const alert = toLeadAlert(params.alert);
  // Đọc một lần cho cả lượt phân trang, không phải một lần mỗi trang.
  const alertContext = alert ? await fetchLeadAlertContext(supabase) : undefined;

  do {
    const page = await fetchLeadsPage(
      actor,
      {
        ...params,
        limit: String(MAX_PAGE_SIZE),
        offset: String(offset),
      },
      supabase,
      ownerEmails,
      alertContext,
    );
    if (offset === 0) total = page.total;
    settingsByProduct = page.alertSettingsByProduct;
    rows.push(...page.rows);
    offset += page.rows.length;

    // A zero-row page guards against a concurrent deletion or a backend
    // cursor anomaly and makes the loop finite even when the count changes.
    if (page.rows.length === 0) break;
  } while (rows.length < total);

  // The SQL predicate is a superset filter (loosest thresholds, and no way to
  // express "contacted after the promised time" in PostgREST). resolveLeadAlerts
  // is the single definition of what an alert IS, so it settles the answer here
  // — which also keeps the list and the row badges from ever disagreeing.
  //
  // total is recomputed from the filtered rows: the count PostgREST returned
  // belongs to the looser query, and "X of Y" must not quote a number nothing
  // on screen adds up to.
  if (alert && settingsByProduct) {
    const statuses = await fetchLeadStatusMap(supabase);
    const matched = rows.filter((lead) =>
      resolveLeadAlerts(
        lead,
        lead.status_id ? statuses.get(lead.status_id) ?? null : null,
        settingsForLead(settingsByProduct, lead.product),
      ).includes(alert),
    );
    return { rows: matched, total: matched.length };
  }

  return { rows, total };
}

/** Every status, archived included: an archived one still labels old rows. */
async function fetchLeadStatusMap(
  supabase: SupabaseClient
): Promise<Map<string, LeadStatus>> {
  const { data, error } = await supabase
    .from("lead_statuses")
    .select(LEAD_STATUS_COLUMNS);
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as LeadStatus[]).map((status) => [status.id, status]),
  );
}

const ALERT_SETTINGS_DEFAULTS = {
  no_contact_hours: 24,
  stale_days: 3,
  max_attempts: 4,
} as const;

/**
 * Both threshold rows, with defaults filled in for a product whose row is
 * missing. Three callers needed this — the list, the Overview, and now the
 * table badges — and each was growing its own copy of the defaults.
 */
export async function fetchLeadAlertSettings(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<LeadAlertSettingsByProduct> {
  const { data, error } = await supabase
    .from("lead_alert_settings")
    .select("product,no_contact_hours,stale_days,max_attempts");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as LeadAlertSettings[];
  return {
    pc: rows.find((row) => row.product === "pc") ?? { product: "pc", ...ALERT_SETTINGS_DEFAULTS },
    health:
      rows.find((row) => row.product === "health") ?? { product: "health", ...ALERT_SETTINGS_DEFAULTS },
  };
}

const LEAD_STATUS_COLUMNS = "id,label,color,position,kind,archived_at";
const LEAD_INTERACTION_TYPE_COLUMNS =
  "id,label,color,position,counts_as_contact,archived_at";

/**
 * The active lead vocabulary. Three screens read it — the list, the config
 * Values tab and the API route — and each used to carry its own copy of the
 * column list and ordering, which is how the two lists drifted apart.
 */
export async function fetchLeadVocabulary(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<{ statuses: LeadStatus[]; types: LeadInteractionType[] }> {
  const [statusesResult, typesResult] = await Promise.all([
    supabase
      .from("lead_statuses")
      .select(LEAD_STATUS_COLUMNS)
      .is("archived_at", null)
      .order("position"),
    supabase
      .from("lead_interaction_types")
      .select(LEAD_INTERACTION_TYPE_COLUMNS)
      .is("archived_at", null)
      .order("position"),
  ]);
  if (statusesResult.error) throw new Error(statusesResult.error.message);
  if (typesResult.error) throw new Error(typesResult.error.message);
  return {
    statuses: (statusesResult.data ?? []) as LeadStatus[],
    types: (typesResult.data ?? []) as LeadInteractionType[],
  };
}

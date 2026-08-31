import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { LeadAlert } from "./alerts";
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
    alert: toLeadAlert(params.alert),
    limit: count(params.limit, LEAD_PAGE_SIZE, MAX_PAGE_SIZE),
    offset: count(params.offset, 0, 1_000_000) || 0,
  };
}

const LEAD_COLUMNS =
  "id,display_number,product,event_id,full_name,phone,email," +
  "assigned_to_email,assigned_at,assigned_by_email,status_id," +
  "first_contacted_at,last_contacted_at,contact_attempt_count," +
  "next_follow_up_at,closed_at,created_by_email,created_at," +
  "updated_by_email,updated_at,custom_values,archived_at";
// event_id is a uuid. Every screen wants the event's NAME, so it is embedded
// here rather than left to each caller: the list rendered the raw uuid in the
// Event column, and the filter dropdown offered uuids as its choices.
const LEAD_LIST_COLUMNS =
  `${LEAD_COLUMNS},lead_events(name),lead_interactions(id,type_id,occurred_at)`;

export async function fetchLeadsPage(
  actor: LeadActor,
  params: LeadListParams,
  supabase: SupabaseClient = getSupabaseAdmin(),
  ownerEmails?: string[] | null
): Promise<{ rows: LeadRow[]; total: number; filter: LeadListFilter }> {
  const filter = buildLeadListFilter(actor, params, ownerEmails);
  let alertSettings: LeadAlertSettings | null = null;
  let terminalStatusIds: string[] = [];
  if (filter.alert) {
    const [settingsResult, statusesResult] = await Promise.all([
      supabase
        .from("lead_alert_settings")
        .select("product,no_contact_hours,stale_days,max_attempts")
        .eq("product", filter.product ?? "health")
        .maybeSingle(),
      supabase
        .from("lead_statuses")
        .select("id")
        .is("archived_at", null)
        .in("kind", ["won", "lost"]),
    ]);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (statusesResult.error) throw new Error(statusesResult.error.message);
    alertSettings = (settingsResult.data ?? {
      product: filter.product ?? "health", no_contact_hours: 24, stale_days: 3, max_attempts: 4,
    }) as LeadAlertSettings;
    terminalStatusIds = (statusesResult.data ?? []).map((row) => (row as { id: string }).id);
  }
  let query = supabase
    .from("leads")
    .select(LEAD_LIST_COLUMNS, { count: "exact" })
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(filter.offset, filter.offset + filter.limit - 1);

  if (filter.product) query = query.eq("product", filter.product);
  if (filter.ownerEmails) query = query.in("assigned_to_email", filter.ownerEmails);
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
  };
}

function toLeadRowWithInteractionHistory(row: unknown): LeadRow {
  const source = row as LeadRow & {
    lead_interactions?: LeadInteractionPreview[] | null;
    lead_events?: { name?: string | null } | null;
  };
  const { lead_interactions, lead_events, ...lead } = source;
  return {
    ...lead,
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
    );
    total = page.total;
    rows.push(...page.rows);
    offset += page.rows.length;

    // A zero-row page guards against a concurrent deletion or a backend
    // cursor anomaly and makes the loop finite even when the count changes.
    if (page.rows.length === 0) break;
  } while (rows.length < total);

  return { rows, total };
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

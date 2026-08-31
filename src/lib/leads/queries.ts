import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { LeadAlert } from "./alerts";
import type { LeadActor } from "./access";
import {
  LEAD_INTERACTION_HISTORY_LIMIT,
  toLeadProduct,
  type LeadAlertSettings,
  type LeadInteractionPreview,
  type LeadProduct,
  type LeadRow,
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
  product: LeadProduct;
  assignedTo: string | null;
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
  params: LeadListParams
): LeadListFilter {
  const requested = text(params.assigned_to);
  return {
    product: toLeadProduct(params.product),
    assignedTo: actor.isManager
      ? requested?.toLowerCase() ?? null
      : actor.email.trim().toLowerCase(),
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
const LEAD_LIST_COLUMNS =
  `${LEAD_COLUMNS},lead_interactions(id,type_id,occurred_at)`;

export async function fetchLeadsPage(
  actor: LeadActor,
  params: LeadListParams,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<{ rows: LeadRow[]; total: number; filter: LeadListFilter }> {
  const filter = buildLeadListFilter(actor, params);
  let alertSettings: LeadAlertSettings | null = null;
  let terminalStatusIds: string[] = [];
  if (filter.alert) {
    const [settingsResult, statusesResult] = await Promise.all([
      supabase
        .from("lead_alert_settings")
        .select("product,no_contact_hours,stale_days,max_attempts")
        .eq("product", filter.product)
        .maybeSingle(),
      supabase
        .from("lead_statuses")
        .select("id")
        .eq("product", filter.product)
        .is("archived_at", null)
        .in("kind", ["won", "lost"]),
    ]);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (statusesResult.error) throw new Error(statusesResult.error.message);
    alertSettings = (settingsResult.data ?? {
      product: filter.product, no_contact_hours: 24, stale_days: 3, max_attempts: 4,
    }) as LeadAlertSettings;
    terminalStatusIds = (statusesResult.data ?? []).map((row) => (row as { id: string }).id);
  }
  let query = supabase
    .from("leads")
    .select(LEAD_LIST_COLUMNS, { count: "exact" })
    .is("archived_at", null)
    .eq("product", filter.product)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(filter.offset, filter.offset + filter.limit - 1);

  if (filter.assignedTo) query = query.eq("assigned_to_email", filter.assignedTo);
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
  };
  const { lead_interactions, ...lead } = source;
  return {
    ...lead,
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
  supabase: SupabaseClient = getSupabaseAdmin()
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

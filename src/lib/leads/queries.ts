import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { LeadActor } from "./access";
import { toLeadProduct, type LeadProduct, type LeadRow } from "./types";

export const LEAD_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export type LeadListParams = {
  product?: unknown;
  assigned_to?: unknown;
  event_id?: unknown;
  status_id?: unknown;
  limit?: unknown;
  offset?: unknown;
};

export type LeadListFilter = {
  product: LeadProduct;
  assignedTo: string | null;
  eventId: string | null;
  statusId: string | null;
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

export async function fetchLeadsPage(
  actor: LeadActor,
  params: LeadListParams,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<{ rows: LeadRow[]; total: number; filter: LeadListFilter }> {
  const filter = buildLeadListFilter(actor, params);
  let query = supabase
    .from("leads")
    .select(LEAD_COLUMNS, { count: "exact" })
    .is("archived_at", null)
    .eq("product", filter.product)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(filter.offset, filter.offset + filter.limit - 1);

  if (filter.assignedTo) query = query.eq("assigned_to_email", filter.assignedTo);
  if (filter.eventId) query = query.eq("event_id", filter.eventId);
  if (filter.statusId) query = query.eq("status_id", filter.statusId);

  const { data, error, count: total } = await query;
  if (error) throw new Error(error.message);
  return {
    rows: (data ?? []) as unknown as LeadRow[],
    total: total ?? 0,
    filter,
  };
}

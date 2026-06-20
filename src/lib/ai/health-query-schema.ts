// Structured query cho mảng HEALTH (bảng health_mart). Validate TS thuần + whitelist.
// Health khác P&C: đếm cả POLICY (theo primary_member_id) lẫn CLIENT (num_client);
// paid theo paid_to_date; commission = agent_received/eps_*; rate trên carriers_messer_paid;
// period theo report_month. Mọi định nghĩa khớp HealthSalesDashboard.summarizeRows.

export const HEALTH_METRICS = [
  "policy_count", // số policy (unique primary_member_id, eligible)
  "client_count", // tổng num_client (theo policy)
  "active_policy_count", // policy của report month MỚI NHẤT có data (scorecard "Active Policies")
  "active_client_count", // client của report month mới nhất có data ("Active Clients")
  "paid_policy_count", // policy đã paid (có paid_to_date)
  "unpaid_policy_count", // policy chưa paid
  "policy_paid_rate", // paid_policy / policy * 100
  "sum_agent_commission", // tổng agent_received
  "sum_eps_commission", // tổng (carriers_messer_paid - agent_received)
  "sum_eps_override", // tổng eps_override_received
  "sum_eps_split", // tổng eps_split
  "sum_carrier_paid", // tổng carriers_messer_paid
  "agent_commission_rate", // agent_received / carriers_messer_paid * 100
  "eps_commission_rate", // eps_commission / carriers_messer_paid * 100
  "eps_split_rate", // eps_split / carriers_messer_paid * 100
  "eps_override_rate", // eps_override_received / carriers_messer_paid * 100
  "list", // liệt kê policy
] as const;
export type HealthMetric = (typeof HEALTH_METRICS)[number];

export const HEALTH_GROUP_BY = [
  "carrier",
  "state",
  "agent",
  "plan",
  "month",
] as const;
export type HealthGroupBy = (typeof HEALTH_GROUP_BY)[number];

export const HEALTH_PAID_FILTER = ["paid", "unpaid", "any"] as const;
export type HealthPaidFilter = (typeof HEALTH_PAID_FILTER)[number];

export type HealthQueryFilters = {
  /** Inclusive month range trên report_month, "YYYY-MM". */
  monthStart?: string;
  monthEnd?: string;
  carrier?: string;
  state?: string;
  agent?: string; // chỉ áp khi user có quyền xem agent khác (server vẫn ép scope)
  plan?: string;
  /** Tên member/khách (primary_member_id hoặc deal_name) — khớp một phần. */
  memberName?: string;
  paid?: HealthPaidFilter;
};

export type HealthStructuredQuery = {
  metric: HealthMetric;
  filters: HealthQueryFilters;
  groupBy?: HealthGroupBy;
  unsupported?: boolean;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SAFE_TEXT_RE = /^[\w .,&/()-]{1,80}$/;

function asMonth(value: unknown): string | undefined {
  return typeof value === "string" && MONTH_RE.test(value.trim())
    ? value.trim()
    : undefined;
}
function asSafeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return SAFE_TEXT_RE.test(trimmed) ? trimmed : undefined;
}
function asEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T
): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

export function parseHealthStructuredQuery(
  raw: unknown
): HealthStructuredQuery | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const metric = asEnum(obj.metric, HEALTH_METRICS);
  if (!metric) return null;

  const rawFilters =
    obj.filters && typeof obj.filters === "object"
      ? (obj.filters as Record<string, unknown>)
      : {};

  const filters: HealthQueryFilters = {};
  const monthStart = asMonth(rawFilters.monthStart);
  const monthEnd = asMonth(rawFilters.monthEnd);
  if (monthStart) filters.monthStart = monthStart;
  if (monthEnd) filters.monthEnd = monthEnd;

  const carrier = asSafeText(rawFilters.carrier);
  const state = asSafeText(rawFilters.state);
  const agent = asSafeText(rawFilters.agent);
  const plan = asSafeText(rawFilters.plan);
  const memberName = asSafeText(rawFilters.memberName);
  if (carrier) filters.carrier = carrier;
  if (state) filters.state = state;
  if (agent) filters.agent = agent;
  if (plan) filters.plan = plan;
  if (memberName) filters.memberName = memberName;

  const paid = asEnum(rawFilters.paid, HEALTH_PAID_FILTER);
  if (paid && paid !== "any") filters.paid = paid;

  if (filters.monthStart && filters.monthEnd && filters.monthStart > filters.monthEnd) {
    [filters.monthStart, filters.monthEnd] = [filters.monthEnd, filters.monthStart];
  }

  const groupBy = asEnum(obj.groupBy, HEALTH_GROUP_BY);

  return {
    metric,
    filters,
    ...(groupBy ? { groupBy } : {}),
    ...(obj.unsupported === true ? { unsupported: true } : {}),
  };
}

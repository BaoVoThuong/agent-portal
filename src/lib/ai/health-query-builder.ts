// Xây query Supabase trên health_mart từ HealthStructuredQuery ĐÃ validate.
//
// BẢO MẬT: scopedAgent do SERVER tính từ session (giống dashboard/health/page.tsx).
//   scopedAgent string -> luôn .eq("agent", scopedAgent); null -> không lọc agent.
// Builder chỉ lọc tĩnh (month/carrier/state/plan + scope). Eligible-dedup, paid và
// đếm policy/client làm ở health-aggregate để khớp 1:1 dashboard.

import type { HealthStructuredQuery } from "./health-query-schema";
import type { PcQueryLike } from "./pc-query-builder";

// Dùng lại cùng interface chainable với P&C (đủ method: eq/gte/lte/ilike/order/limit).
export type HealthQueryLike = PcQueryLike;
export interface HealthTableSource {
  from: (table: string) => HealthQueryLike;
}

export const HEALTH_MART_TABLE = "health_mart";

const SELECT_COLUMNS = [
  "deal_name",
  "state",
  "carrier",
  "plan_name",
  "primary_member_id",
  "agent",
  "broker_effective_date",
  "paid_to_date",
  "report_month",
  "carriers_messer_paid",
  "agent_received",
  "eps_override_received",
  "eps_split",
  "num_client",
].join(",");

function monthToStartDate(month: string): string {
  return `${month}-01`;
}
function monthToEndDate(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}

export function buildHealthMartQuery(
  source: HealthTableSource,
  query: HealthStructuredQuery,
  scopedAgent: string | null
): HealthQueryLike {
  let q = source.from(HEALTH_MART_TABLE).select(SELECT_COLUMNS);

  // --- Lớp ép quyền ---
  if (scopedAgent !== null) {
    q = q.eq("agent", scopedAgent);
  }

  const { filters } = query;

  if (filters.monthStart) {
    q = q.gte("report_month", monthToStartDate(filters.monthStart));
  }
  if (filters.monthEnd) {
    q = q.lte("report_month", monthToEndDate(filters.monthEnd));
  }
  if (filters.carrier) q = q.eq("carrier", filters.carrier);
  if (filters.state) q = q.eq("state", filters.state);
  if (filters.plan) q = q.eq("plan_name", filters.plan);
  // agent filter chỉ có hiệu lực khi scopedAgent=null (user có quyền xem agent khác).
  if (filters.agent && scopedAgent === null) q = q.eq("agent", filters.agent);
  if (filters.memberName) {
    q = q.ilike("primary_member_id", `%${filters.memberName}%`);
  }

  // Không limit/range ở đây — route phân trang qua .range() để lấy TOÀN BỘ dòng
  // (giống dashboard), tránh mất dữ liệu khi health_mart > 1000 dòng.
  q = q.order("report_month", { ascending: false });

  return q;
}

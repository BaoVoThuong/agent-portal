// Structured query mà LLM được phép trả về cho mảng P&C.
// Validate bằng TypeScript thuần + whitelist cứng (repo chưa dùng zod) — bất kỳ
// field/giá trị lạ nào đều bị loại bỏ trước khi chạm tới Supabase.
//
// Các định nghĩa nghiệp vụ (active/renewal/unpaid/estimate commission) khớp 1:1
// với dashboard P&C (summarizeRows / estimateCommission trong AgentPcDashboard.tsx).

export const PC_METRICS = [
  "count", // số policy (premium > 0)
  "active_count", // policy đang hiệu lực: premium>0 và expired_date >= hôm nay
  "renewal_count", // policy có status = RENEWAL
  "renewal_rate", // renewal_count / count * 100
  "sum_premium", // tổng premium = sum(max(true_premium ?? premium, 0))
  "sum_agent_commission", // tổng agent_commission_amount (phần hoa hồng của AGENT)
  "sum_total_commission", // tổng total_commission (= agent + eps, hoa hồng TỔNG)
  "sum_eps_commission", // tổng eps_commission_amount (phần của EPS/công ty)
  "estimate_unpaid_agent_commission", // ước tính agent commission cho policy CHƯA paid
  // --- Tỉ lệ hoa hồng / premium (× 100). LƯU Ý 3 loại khác nhau ở tử số: ---
  "agent_commission_rate", // sum_agent_commission / sum_premium  ("Agent Comm Rate")
  "total_commission_rate", // sum_total_commission / sum_premium  ("Commission Rate" - company)
  "eps_commission_rate", // sum_eps_commission   / sum_premium  ("EPS Comm Rate" - company)
  "avg_premium_per_policy", // sum_premium / count
  "avg_agent_commission_per_policy", // sum_agent_commission / count
  "list", // liệt kê policy
] as const;
export type PcMetric = (typeof PC_METRICS)[number];

export const PC_GROUP_BY = [
  "company",
  "type",
  "month",
  "agency",
  "agent_name",
  "state",
  "city",
] as const;
export type PcGroupBy = (typeof PC_GROUP_BY)[number];

// "Trạng thái nghiệp vụ" mà người dùng hay hỏi — KHÔNG phải cột status thô.
//  any: mọi policy có premium>0 | active: còn hiệu lực | renewal: status=RENEWAL
export const PC_POLICY_SCOPE = ["any", "active", "renewal"] as const;
export type PcPolicyScope = (typeof PC_POLICY_SCOPE)[number];

export const PC_PAID_FILTER = ["paid", "unpaid", "any"] as const;
export type PcPaidFilter = (typeof PC_PAID_FILTER)[number];

export type PcQueryFilters = {
  /** Inclusive month range trên effective_date, "YYYY-MM". */
  monthStart?: string;
  monthEnd?: string;
  type?: string;
  company?: string;
  agency?: string;
  state?: string;
  city?: string;
  /** Tên agent (chỉ áp khi user có quyền xem agent khác; server vẫn ép scope). */
  agent?: string;
  /** Tên người được bảo hiểm (khách) — khớp một phần, không phân biệt hoa thường. */
  insuredName?: string;
  /** Phạm vi trạng thái policy (active/renewal/any). */
  policyScope?: PcPolicyScope;
  paid?: PcPaidFilter;
};

export type PcStructuredQuery = {
  metric: PcMetric;
  filters: PcQueryFilters;
  groupBy?: PcGroupBy;
  /** Nhãn ngắn cho query này, dùng khi có nhiều queries (vd "Q1 2025", "Q1 2026"). */
  label?: string;
  /** True khi câu hỏi không liên quan dữ liệu P&C. */
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

/**
 * Chuẩn hoá output thô của LLM về một PcStructuredQuery an toàn.
 * Trả về null nếu metric không hợp lệ (không thể tin để chạy).
 */
export function parsePcStructuredQuery(raw: unknown): PcStructuredQuery | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const metric = asEnum(obj.metric, PC_METRICS);
  if (!metric) return null;

  const rawFilters =
    obj.filters && typeof obj.filters === "object"
      ? (obj.filters as Record<string, unknown>)
      : {};

  const filters: PcQueryFilters = {};
  const monthStart = asMonth(rawFilters.monthStart);
  const monthEnd = asMonth(rawFilters.monthEnd);
  if (monthStart) filters.monthStart = monthStart;
  if (monthEnd) filters.monthEnd = monthEnd;

  const type = asSafeText(rawFilters.type);
  const company = asSafeText(rawFilters.company);
  const agency = asSafeText(rawFilters.agency);
  const state = asSafeText(rawFilters.state);
  const city = asSafeText(rawFilters.city);
  const agent = asSafeText(rawFilters.agent);
  const insuredName = asSafeText(rawFilters.insuredName);
  if (type) filters.type = type;
  if (company) filters.company = company;
  if (agency) filters.agency = agency;
  if (state) filters.state = state;
  if (city) filters.city = city;
  if (agent) filters.agent = agent;
  if (insuredName) filters.insuredName = insuredName;

  const policyScope = asEnum(rawFilters.policyScope, PC_POLICY_SCOPE);
  const paid = asEnum(rawFilters.paid, PC_PAID_FILTER);
  if (policyScope && policyScope !== "any") filters.policyScope = policyScope;
  if (paid && paid !== "any") filters.paid = paid;

  if (filters.monthStart && filters.monthEnd && filters.monthStart > filters.monthEnd) {
    [filters.monthStart, filters.monthEnd] = [filters.monthEnd, filters.monthStart];
  }

  const groupBy = asEnum(obj.groupBy, PC_GROUP_BY);

  const label = asSafeText(obj.label);

  return {
    metric,
    filters,
    ...(groupBy ? { groupBy } : {}),
    ...(label ? { label } : {}),
    ...(obj.unsupported === true ? { unsupported: true } : {}),
  };
}

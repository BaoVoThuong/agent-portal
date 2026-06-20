// Xây query Supabase trên pc_mart từ một PcStructuredQuery ĐÃ validate.
//
// QUAN TRỌNG (bảo mật): đây là nơi DUY NHẤT ép phạm vi quyền. scopedAgentName do
// SERVER tính từ session (giống dashboard/pc/page.tsx), KHÔNG bao giờ lấy từ LLM.
// - scopedAgentName là string  -> luôn .eq("agent_name", scopedAgentName)
// - scopedAgentName là null     -> không lọc theo tên (chỉ khi user có company.view_all)
//
// Builder chỉ lọc theo các điều kiện "tĩnh" (tháng/type/company/agency). Các điều
// kiện NGHIỆP VỤ (active/renewal/paid/unpaid) được áp ở pc-aggregate để khớp 1:1
// với công thức dashboard (cần expired_date >= today, status=RENEWAL không phân biệt
// hoa thường, paid_producer null/empty...). Builder lấy đủ cột cho aggregate dùng.
//
// Hàm thuần, không tự gọi network: nhận một "query-like" object (Supabase builder
// hoặc fake trong test) nên kiểm thử được mà không cần Supabase thật.

import type { PcStructuredQuery } from "./pc-query-schema";

/** Tập con interface của Supabase query builder mà file này dùng (chainable). */
export interface PcQueryLike {
  select: (columns: string) => PcQueryLike;
  eq: (column: string, value: string) => PcQueryLike;
  gte: (column: string, value: string) => PcQueryLike;
  lte: (column: string, value: string) => PcQueryLike;
  ilike: (column: string, pattern: string) => PcQueryLike;
  order: (column: string, opts: { ascending: boolean }) => PcQueryLike;
  limit: (count: number) => PcQueryLike;
}

export interface PcTableSource {
  from: (table: string) => PcQueryLike;
}

export const PC_MART_TABLE = "pc_mart";
export const PC_RESULT_ROW_CAP = 2000;

const SELECT_COLUMNS = [
  "agent_name",
  "agency_name",
  "insured_name",
  "type",
  "company",
  "policy_number",
  "premium",
  "true_premium",
  "carrier_commission",
  "agent_commission_amount",
  "total_commission",
  "eps_commission_amount",
  "effective_date",
  "expired_date",
  "status",
  "paid_producer",
  "state",
  "city",
].join(",");

function monthToStartDate(month: string): string {
  return `${month}-01`;
}

function monthToEndDate(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}

/**
 * Build query đọc pc_mart theo structured query + phạm vi quyền do server ép.
 * @param source     nguồn bảng (Supabase admin client hoặc fake test)
 * @param query      structured query ĐÃ qua parsePcStructuredQuery
 * @param scopedAgentName  tên agent từ session; null nếu có quyền view_all
 */
export function buildPcMartQuery(
  source: PcTableSource,
  query: PcStructuredQuery,
  scopedAgentName: string | null
): PcQueryLike {
  let q = source.from(PC_MART_TABLE).select(SELECT_COLUMNS);

  // --- Lớp ép quyền: bất biến, không phụ thuộc LLM ---
  if (scopedAgentName !== null) {
    q = q.eq("agent_name", scopedAgentName);
  }

  const { filters } = query;

  if (filters.monthStart) {
    q = q.gte("effective_date", monthToStartDate(filters.monthStart));
  }
  if (filters.monthEnd) {
    q = q.lte("effective_date", monthToEndDate(filters.monthEnd));
  }
  if (filters.type) q = q.eq("type", filters.type);
  if (filters.company) q = q.eq("company", filters.company);
  if (filters.agency) q = q.eq("agency_name", filters.agency);
  if (filters.state) q = q.eq("state", filters.state);
  if (filters.city) q = q.eq("city", filters.city);
  if (filters.insuredName) {
    // khớp một phần, không phân biệt hoa thường (vd "thuan" khớp "Thuan Nguyen")
    q = q.ilike("insured_name", `%${filters.insuredName}%`);
  }

  q = q.order("effective_date", { ascending: false }).limit(PC_RESULT_ROW_CAP);

  return q;
}

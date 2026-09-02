import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { LEAD_PRODUCTS, type LeadProduct } from "./types";

export type AssignmentWeightRow = {
  product: LeadProduct;
  agent_email: string;
  weight: number;
  current_weight: number;
  position: number;
  is_active: boolean;
};

export type AutoAssignOutcome = {
  assigned: number;
  unassigned: number;
  /** Why leads were left in the pool, when any were. */
  reason?: string;
};

export async function fetchAssignmentWeights(
  product: LeadProduct,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<AssignmentWeightRow[]> {
  const { data, error } = await supabase
    .from("lead_assignment_weights")
    .select("product,agent_email,weight,current_weight,position,is_active")
    .eq("product", product)
    .order("position")
    .order("agent_email");
  if (error) throw new Error(error.message);
  return (data ?? []) as AssignmentWeightRow[];
}

/**
 * Cờ "tự chia khi import" của MỘT product.
 *
 * Phải có `product`: cờ này được ghi theo từng product (một dòng
 * `lead_alert_settings` cho mỗi product), nên đọc mà không lọc thì nhận về dòng
 * nào Postgres trả trước. Bật cho Health thôi mà import P&C cũng tự chia — hoặc
 * ngược lại — tuỳ thứ tự dòng, là một lỗi không tài nào tái hiện theo ý muốn.
 */
export async function isAutoAssignEnabled(
  product: LeadProduct,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<boolean> {
  const { data, error } = await supabase
    .from("lead_alert_settings")
    .select("auto_assign_enabled")
    .eq("product", product)
    .maybeSingle();
  // A missing column means the rollout has not run. Treat that as OFF rather
  // than failing the caller: auto-assign is an addition, not a prerequisite.
  if (error) return false;
  return Boolean(data?.auto_assign_enabled);
}

/**
 * Ai thực sự nhận được lead trong lượt chia này.
 *
 * Ba điều kiện, và điều kiện thứ ba là điều kiện mới: TÀI KHOẢN CÒN HOẠT ĐỘNG.
 * Danh sách chia pool trả lời câu "ai ĐƯỢC PHÉP nhận" — quyết định của admin và
 * không bị RBAC phủ quyết. Nhưng nó không trả lời được câu "người này còn làm ở
 * đây không". Thiếu vế sau thì nhân viên nghỉ việc vẫn nhận lead, và lead nằm
 * im ở một người không đăng nhập được nữa.
 *
 * So email theo bản thường hoá: hai bảng ghi email ở hai đường khác nhau, chỉ
 * cần một bên viết hoa là người đó lặng lẽ rơi khỏi pool.
 */
export function eligibleAssignmentEmails(
  weights: readonly AssignmentWeightRow[],
  activeEmails: ReadonlySet<string>
): string[] {
  return weights
    .filter(
      (row) =>
        row.is_active &&
        row.weight > 0 &&
        activeEmails.has(row.agent_email.trim().toLowerCase())
    )
    .map((row) => row.agent_email);
}

/**
 * Hand a batch of pool leads to agents by configured ratio.
 *
 * All the leads must share one product — the ratio table is per product, and
 * the rotation cursor with it. Callers holding a mixed batch group first.
 *
 * Never throws for "nobody is configured": those leads simply stay in the pool
 * and the outcome says why. Failing a 2,000-row import over a missing ratio
 * would be losing the big job to the small one.
 */
export async function autoAssignLeads(
  leadIds: readonly string[],
  product: LeadProduct,
  actorEmail: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<AutoAssignOutcome> {
  if (leadIds.length === 0) return { assigned: 0, unassigned: 0 };

  // The distribution list IS the answer to "who receives leads". It is not
  // cross-checked against RBAC: an admin curates this list on the Distribute
  // screen, and a second opinion from the permission table would silently
  // override what they set there.
  const weights = await fetchAssignmentWeights(product, supabase);
  const configured = weights.filter((row) => row.is_active && row.weight > 0);
  if (configured.length === 0) {
    return {
      assigned: 0,
      unassigned: leadIds.length,
      reason: `Nobody is set to receive ${product === "pc" ? "P&C" : "Health"} leads.`,
    };
  }

  const { data: accounts, error: accountError } = await supabase
    .from("portal_account")
    .select("email")
    .in("email", configured.map((row) => row.agent_email))
    .eq("is_active", true);
  if (accountError) throw new Error(accountError.message);
  const activeEmails = new Set(
    ((accounts ?? []) as { email: string }[]).map((row) => row.email.trim().toLowerCase())
  );

  const eligible = eligibleAssignmentEmails(weights, activeEmails);
  if (eligible.length === 0) {
    // Câu khác hẳn trường hợp trên: ở đây admin ĐÃ cấu hình người nhận, nhưng
    // tài khoản của họ đã bị tắt. Gộp hai câu làm một là bắt admin đi tìm trong
    // màn hình chia pool một thứ không nằm ở đó.
    return {
      assigned: 0,
      unassigned: leadIds.length,
      reason: "Everyone set to receive these leads has a deactivated account.",
    };
  }

  const { data, error } = await supabase.rpc("assign_leads_round_robin", {
    p_lead_ids: leadIds,
    p_product: product,
    p_eligible_emails: eligible,
    p_actor_email: actorEmail,
  });
  if (error) throw new Error(error.message);
  const assigned = Array.isArray(data) ? data.length : 0;
  return { assigned, unassigned: leadIds.length - assigned };
}

/** Split a mixed batch so each product uses its own ratio and its own cursor. */
/**
 * Chia danh sách lead thành từng nhóm product để chạy vòng xoay riêng.
 *
 * `scopedTo` là product của lượt bấm Distribute, hoặc null khi chia tất cả.
 *
 * Một lead có thể mang CẢ HAI product, nên "lead này thuộc nhóm nào" không còn
 * đọc được từ dữ liệu của riêng nó:
 *
 *  - Bấm Distribute ở một tab → mọi lead trong pool đó vào đúng nhóm ĐÓ. Lead
 *    `[pc, health]` bấm ở tab Health thì phải tiêu cursor của Health; gom theo
 *    dữ liệu của lead sẽ đẩy nó sang P&C, tức bấm một bên mà bên kia bị trừ.
 *  - Chia tất cả → gom theo product ĐẦU TIÊN nó mang, để lead multi-product chỉ
 *    được tính MỘT lần. Đếm hai lần thì lượt thứ hai vẫn cộng/trừ cursor rồi mới
 *    phát hiện lead đã có chủ (RPC dời cursor TRƯỚC khi update), nên một lead bị
 *    bỏ qua vẫn đốt mất một lượt của người khác.
 */
export function groupLeadIdsByProduct(
  leads: readonly {
    id: string;
    product?: LeadProduct | null;
    products?: readonly LeadProduct[] | null;
  }[],
  scopedTo: LeadProduct | null = null
): Record<LeadProduct, string[]> {
  const grouped: Record<LeadProduct, string[]> = { pc: [], health: [] };
  for (const lead of leads) {
    if (scopedTo) {
      grouped[scopedTo].push(lead.id);
      continue;
    }
    // Thứ tự cố định theo LEAD_PRODUCTS, không theo thứ tự mảng trong DB: cùng
    // một lead phải luôn rơi vào cùng một nhóm giữa hai lần chạy.
    const first =
      LEAD_PRODUCTS.find((product) => lead.products?.includes(product)) ??
      lead.product ??
      null;
    // Lead chưa phân loại product không thuộc pool nào — bỏ qua, không đoán.
    if (first) grouped[first].push(lead.id);
  }
  return grouped;
}

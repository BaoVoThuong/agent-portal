import { normalizeAgentName } from "@/lib/agent-name";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Tên agent dùng làm KHOÁ PHẠM VI cho Registration, Agent Dashboard và AI chat.
 *
 * Nguồn là `agent_commission_names` (Phase D, sửa gốc S1): mỗi account tối đa
 * một tên hoa hồng, tên là duy nhất, chỉ Account Manager đặt được. Tên hiển thị
 * (`portal_account.name`) KHÔNG còn quyết định phạm vi — đổi tên hiển thị không
 * còn là đổi dữ liệu người đó thấy, và hai account trùng tên không còn thấy dữ
 * liệu của nhau.
 *
 * Account chưa có tên hoa hồng → "" → truy vấn phía sau chỉ còn bản ghi chính họ
 * nộp (fail-closed). Không có account active → "".
 */
const COMMISSION_SELECT = "id,agent_commission_names(agent_name)";

type CommissionRow = {
  agent_commission_names?: { agent_name?: string | null } | { agent_name?: string | null }[] | null;
};

// Chỉ lỗi "bảng/quan hệ chưa có" (rollout Phase D chưa chạy) mới được rơi về
// khoá cũ. Lỗi khác phải ném — rơi về tên hiển thị là mở lại S1.
function isMissingCommissionSchema(error: { code?: string } | null): boolean {
  return error?.code === "PGRST200" || error?.code === "PGRST205" || error?.code === "42P01";
}

export async function fetchScopeAgentName(email: string | null | undefined): Promise<string> {
  const normalizedEmail = email?.trim();
  if (!normalizedEmail) return "";

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select(COMMISSION_SELECT)
    .eq("email", normalizedEmail)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    if (!isMissingCommissionSchema(error)) throw new Error(error.message);
    // Trước rollout 2026-09-29-authz-phase-d.sql: khoá cũ là tên hiển thị.
    const legacy = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("name")
      .eq("email", normalizedEmail)
      .eq("is_active", true)
      .maybeSingle();
    if (legacy.error) throw new Error(legacy.error.message);
    return normalizeAgentName((legacy.data as { name?: string | null } | null)?.name ?? "");
  }

  const mapping = (data as CommissionRow | null)?.agent_commission_names;
  const agentName = Array.isArray(mapping) ? mapping[0]?.agent_name : mapping?.agent_name;
  return normalizeAgentName(agentName ?? "");
}

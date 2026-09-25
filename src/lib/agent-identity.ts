import { normalizeAgentName } from "@/lib/agent-name";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Tên agent dùng làm KHOÁ PHẠM VI cho Registration, Agent Dashboard và AI chat.
 *
 * Đọc tươi từ `portal_account` mỗi lần, KHÔNG lấy `session.user.name`: tên trong
 * phiên là tên lúc đăng nhập (không bao giờ làm mới), còn với Google là tên hồ sơ
 * Google người dùng tự đặt. Đổi tên thành tên agent khác từng đủ để xem/sửa/xoá
 * dữ liệu hoa hồng của họ (S1). Từ 2026-09-26 tên chỉ Account Manager sửa được.
 *
 * Đây là giảm nhẹ tạm thời: khoá thật sẽ là bảng ánh xạ định danh (Phase D).
 * Không có account active → "" → truy vấn phía sau không thấy gì (fail-closed).
 */
export async function fetchScopeAgentName(email: string | null | undefined): Promise<string> {
  const normalizedEmail = email?.trim();
  if (!normalizedEmail) return "";

  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select("name")
    .eq("email", normalizedEmail)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return normalizeAgentName((data as { name?: string | null } | null)?.name ?? "");
}

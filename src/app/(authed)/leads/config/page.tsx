import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Địa chỉ cũ. Cấu hình bảng lead đã gộp vào `/config` — cùng màn hình với ba
 * bảng Health, nhưng **quyền vẫn tách**: `configScopesFor` cắt danh sách bảng
 * theo quyền của chính người đang xem, nên người chỉ có `lead.manage` vào đó
 * chỉ thấy bảng Event Leads.
 */
export default function LegacyLeadConfigPage() {
  redirect("/config");
}

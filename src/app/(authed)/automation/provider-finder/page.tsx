import { redirect } from "next/navigation";

/**
 * Trang Provider Finder riêng đã bị ẩn.
 *
 * Tính năng KHÔNG bị xoá: `ProviderFinderClient` trong cùng thư mục vẫn là thứ
 * dựng nên tab "Finder Tool" của Provider List, và `ProviderListClient` import
 * thẳng component đó. Chỉ có đường dẫn riêng này là không còn lối vào.
 *
 * Chuyển hướng thay vì xoá file: người đã bookmark `/automation/provider-finder`
 * vẫn tới đúng chỗ chứa tính năng đó, thay vì gặp 404 rồi đi hỏi.
 *
 * Không cần kiểm quyền ở đây — trang đích tự kiểm bằng
 * `requireAnyPermission([AUTOMATION_PROVIDER_FINDER])`.
 */
export default function ProviderFinderPage() {
  redirect("/automation/provider-list");
}

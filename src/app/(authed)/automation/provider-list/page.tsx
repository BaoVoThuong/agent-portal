import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Địa chỉ cũ. Provider List đã chuyển vào nhóm Task Management ở
 * `/tasks/providers` (2026-10-03).
 *
 * Giữ chuyển hướng chứ không xoá: người ta đã lưu link. Không cần kiểm quyền ở
 * đây — trang đích tự kiểm bằng `requireAnyPermission([AUTOMATION_PROVIDER_FINDER])`.
 */
export default async function LegacyProviderListPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }
  const suffix = query.toString();
  redirect(suffix ? `/tasks/providers?${suffix}` : "/tasks/providers");
}

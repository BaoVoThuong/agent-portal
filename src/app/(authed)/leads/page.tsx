import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Địa chỉ cũ. Event Leads đã chuyển vào nhóm Task Management ở `/tasks/leads`.
 *
 * Giữ chuyển hướng chứ không xoá: người ta đã lưu link, và Overview sinh liên
 * kết sâu dạng `?alert=stale`. Một link chết ở đây là một người bấm vào rồi
 * thấy trang 404 mà không hiểu vì sao.
 *
 * `searchParams` được chuyển tiếp nguyên vẹn để `?alert=`, `?product=`,
 * `?view=` vẫn hoạt động.
 */
export default async function LegacyLeadsPage({
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
  redirect(suffix ? `/tasks/leads?${suffix}` : "/tasks/leads");
}

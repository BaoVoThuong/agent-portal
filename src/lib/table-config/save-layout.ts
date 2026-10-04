import type { LayoutEntry } from "./layout";

export type SaveLayoutResult =
  | { ok: true; updatedAt: string | null }
  | { ok: false; error: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Lưu layout bảng của chính người đang dùng (`/api/config/layout`).
 *
 * Server so `expected_updated_at` để không ghi đè bản mới hơn. Nhưng layout là
 * của RIÊNG người này: 409 chỉ có nghĩa là họ vừa lưu ở tab / máy khác, hoặc
 * màn hình chưa kịp đọc bản đã lưu. Báo "Layout changed elsewhere" lúc đó chỉ
 * bắt họ tải lại trang rồi làm lại đúng thao tác vừa làm. Nên: đọc `updated_at`
 * mới nhất rồi ghi lại lựa chọn hiện tại — MỘT lần, để không lặp vô hạn.
 */
export async function saveUserTableLayout(
  scope: string,
  layout: LayoutEntry[],
  expectedUpdatedAt: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<SaveLayoutResult> {
  const put = (expected: string | null) =>
    fetchImpl("/api/config/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, layout, expected_updated_at: expected }),
    }).catch(() => null);

  let response = await put(expectedUpdatedAt);
  if (response?.status === 409) {
    const latest = await fetchImpl(`/api/config/layout?scope=${encodeURIComponent(scope)}`, {
      cache: "no-store",
    })
      .then((reply) => (reply.ok ? reply.json() : null))
      .catch(() => null) as { updated_at?: unknown } | null;
    if (latest) {
      response = await put(typeof latest.updated_at === "string" ? latest.updated_at : null);
    }
  }

  const payload = (await response?.json().catch(() => null)) as
    | { updated_at?: unknown; error?: unknown }
    | null
    | undefined;
  if (response?.ok) {
    return { ok: true, updatedAt: typeof payload?.updated_at === "string" ? payload.updated_at : null };
  }
  return {
    ok: false,
    error: typeof payload?.error === "string" ? payload.error : "Could not save the table layout.",
  };
}

/**
 * Phía client của `json-etag.ts`: GET một danh sách, gửi kèm ETag của lần tải
 * trước cho cùng `key`. Server trả 304 thì parse lại text đã lưu, nên chỗ gọi
 * xử lý y hệt một phản hồi 200 mới (object mới mỗi lần, như `response.json()`).
 *
 * Bản lưu nằm trong bộ nhớ của trang (ref), không vào cache đĩa của trình duyệt.
 */

export type EtagSnapshot = { key: string; etag: string; text: string };

export type EtagFetchResult = { ok: boolean; status: number; data: unknown };

export async function fetchJsonWithEtag(
  url: string,
  key: string,
  slot: { current: EtagSnapshot | null },
): Promise<EtagFetchResult> {
  const previous = slot.current?.key === key ? slot.current : null;
  const response = await fetch(url, {
    cache: "no-store",
    headers: previous ? { "If-None-Match": previous.etag } : undefined,
  });

  if (response.status === 304) {
    if (!previous) return { ok: false, status: 304, data: null };
    return { ok: true, status: 200, data: JSON.parse(previous.text) };
  }

  const text = await response.text();
  if (!response.ok) {
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Trang lỗi HTML từ gateway: chỗ gọi chỉ cần biết là lỗi.
    }
    return { ok: false, status: response.status, data };
  }

  // 200 mà không phải JSON thì ném lỗi, giống `response.json()` trước đây.
  const data: unknown = JSON.parse(text);
  const etag = response.headers.get("ETag");
  slot.current = etag ? { key, etag, text } : null;
  return { ok: true, status: response.status, data };
}

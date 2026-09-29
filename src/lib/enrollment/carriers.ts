import type { EnrollmentRecord } from "./types";

/**
 * Carrier chọn được NHIỀU hãng (2026-09-29).
 *
 * `carrier_ids` là nguồn sự thật; `carrier_id` vẫn còn và luôn bằng phần tử
 * ĐẦU của mảng — trigger `enrollment_sync_carrier_ids` trong DB giữ hai cột
 * khớp nhau. Nhờ vậy khoá ngoại, kiểm "đã điền Carrier chưa" ở Overview và mọi
 * chỗ chỉ cần biết "có hãng hay không" vẫn đọc `carrier_id` được như cũ.
 *
 * Thứ tự trong mảng là thứ tự người dùng chọn, không sắp lại.
 */

/**
 * Danh sách hãng của một hồ sơ. Rơi về `carrier_id` khi dòng chưa có mảng —
 * dữ liệu đọc về từ trước rollout, hoặc một đường đọc chưa select cột mới.
 */
export function enrollmentCarrierIds(
  record: Pick<EnrollmentRecord, "carrier_id" | "carrier_ids">
): string[] {
  if (Array.isArray(record.carrier_ids) && record.carrier_ids.length > 0) {
    return record.carrier_ids;
  }
  return record.carrier_id ? [record.carrier_id] : [];
}

/**
 * Đọc danh sách hãng từ thân request.
 *
 * Nhận `carrier_ids` (mảng). Vẫn nhận `carrier_id` (một chuỗi) cho client cũ
 * còn mở trong lúc deploy: nó nghĩa là "chỉ hãng này", rỗng là xoá hết.
 * Trả `undefined` khi request không nói gì về Carrier, `null` khi sai kiểu.
 */
export function readCarrierIdsInput(
  body: Record<string, unknown>
): string[] | null | undefined {
  if ("carrier_ids" in body) {
    const raw = body.carrier_ids;
    if (raw === null) return [];
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
      return null;
    }
    return dedupeCarrierIds(raw as string[]);
  }
  if ("carrier_id" in body) {
    const raw = body.carrier_id;
    if (raw === null || raw === undefined) return [];
    if (typeof raw !== "string") return null;
    return dedupeCarrierIds([raw]);
  }
  return undefined;
}

/** Bỏ khoảng trắng, bỏ rỗng, bỏ trùng; giữ thứ tự lần xuất hiện đầu. */
export function dedupeCarrierIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** So cả nội dung lẫn thứ tự — hãng đầu tiên là hãng "chính". */
export function sameCarrierIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Bấm một hãng trong menu: có rồi thì bỏ, chưa có thì thêm vào cuối. */
export function toggleCarrierId(current: readonly string[], id: string): string[] {
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
}

/**
 * Một lượt sửa bị 409 có gửi lại được với bản mới nhất không — dùng chung cho
 * Enrollment (`patchRecord`) và Task (`patchTask`).
 *
 * 409 chỉ nói `updated_at` đã đổi, không nói ĐỔI GÌ. Mốc giờ bị đẩy lên bởi cả
 * những thứ không đụng tới trường nào — upload file, comment, reaction... Bỏ
 * luôn lượt sửa trong những trường hợp đó là làm mất việc người dùng vừa làm vì
 * một thay đổi họ không hề xung đột (lỗi Enrollment 2026-09-30).
 *
 * Gửi lại được khi MỌI trường trong patch vẫn giữ nguyên giá trị giữa bản người
 * dùng đã nhìn (`before`) và bản server hiện tại (`canonical`) — tức không ai sửa
 * cùng trường. `custom_values` so từng khoá con. Có trường đã bị đổi thì trả
 * false: đè lên thay đổi của người khác là thứ kiểm tra `updated_at` sinh ra để chặn.
 */
export type ConflictRetryTables = {
  /** Khoá chỉ có trong request, không phải trường của bản ghi — không so. */
  requestOnlyKeys: ReadonlySet<string>;
  /**
   * Khoá request → các cột server đọc hoặc ghi kèm. Không có trong bảng thì so
   * đúng cột cùng tên.
   */
  relatedColumns: Readonly<Record<string, readonly string[]>>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function canRetryAfterConflict(
  patch: Record<string, unknown>,
  before: Record<string, unknown>,
  canonical: Record<string, unknown>,
  tables: ConflictRetryTables,
): boolean {
  for (const [key, value] of Object.entries(patch)) {
    if (tables.requestOnlyKeys.has(key)) continue;
    if (key === "custom_values") {
      if (!isPlainRecord(value)) return false;
      const beforeValues = isPlainRecord(before.custom_values) ? before.custom_values : {};
      const canonicalValues = isPlainRecord(canonical.custom_values)
        ? canonical.custom_values
        : {};
      for (const subKey of Object.keys(value)) {
        if (!sameValue(beforeValues[subKey], canonicalValues[subKey])) return false;
      }
      continue;
    }
    const columns = tables.relatedColumns[key] ?? [key];
    for (const column of columns) {
      // Trường không có trên bản ghi thì không biết nó đổi hay chưa — không đoán.
      if (!(column in before) && !(column in canonical)) return false;
      if (!sameValue(before[column], canonical[column])) return false;
    }
  }
  return true;
}

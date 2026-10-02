// Most enrollment patch keys are column names, so an optimistic row is just a
// spread of the request over the previous row. `qc_checked` is the exception:
// it is request-only, and the API translates it into qc_checked_at /
// qc_checked_by_email (src/app/api/enrollment/[id]/route.ts:234-235).
//
// Spreading the raw request wrote a key nothing renders and left the columns
// the UI actually reads untouched, so the QC toggle was the one control in the
// module with no optimistic feedback: it appeared to lag for a full round trip,
// and two quick clicks both computed their next value from the same unchanged
// qc_checked_at and sent the identical patch twice, making one click look
// swallowed. Health CS already does this translation for its own request-only
// key (TaskBoardClient.tsx:1930).

/** Mirrors the server's translation so the optimistic row matches what commits. */
export function toOptimisticEnrollmentPatch(
  patch: Record<string, unknown>,
  actorEmail: string,
  nowIso: string
): Record<string, unknown> {
  const withCarrier = mirrorPrimaryCarrier(patch);
  // The server acts only on a real boolean, so anything else falls through
  // untouched and the two sides agree on what counts as a QC change.
  if (typeof withCarrier.qc_checked !== "boolean") return withCarrier;

  const { qc_checked: qcChecked, ...rest } = withCarrier;
  return {
    ...rest,
    qc_checked_at: qcChecked ? nowIso : null,
    qc_checked_by_email: qcChecked ? actorEmail : null,
    qc_stale_notified_at: null,
  };
}

/** Khoá chỉ có trong request, không phải trường của hồ sơ — không so. */
const REQUEST_ONLY_KEYS = new Set(["reopen_reason", "expected_updated_at"]);

/**
 * Request keys → record columns that the server reads or also writes.
 * A retry must include these dependencies: stage updates also close/reopen and
 * clear QC state; QC checks are valid only for the current stage; carrier_ids
 * is mirrored to the legacy carrier_id column.
 */
const RELATED_COLUMNS_FOR_REQUEST_KEY: Record<string, readonly string[]> = {
  carrier_ids: ["carrier_ids", "carrier_id"],
  stage_id: [
    "stage_id",
    "closed_at",
    "qc_checked_at",
    "qc_checked_by_email",
    "qc_stale_notified_at",
  ],
  qc_checked: [
    "qc_checked_at",
    "qc_checked_by_email",
    "qc_stale_notified_at",
    "stage_id",
  ],
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Một lượt sửa bị 409 có gửi lại được với bản mới nhất không.
 *
 * 409 chỉ nói `updated_at` đã đổi, không nói ĐỔI GÌ. Mốc giờ bị đẩy lên bởi cả
 * những thứ không đụng tới trường nào — upload file (`enrollment_touch_activity`),
 * reaction... Bỏ luôn lượt sửa trong những trường hợp đó là làm mất việc người
 * dùng vừa làm vì một thay đổi họ không hề xung đột (lỗi 2026-09-30: tạo hồ sơ
 * kèm file rồi sửa ngay).
 *
 * Gửi lại được khi MỌI trường trong patch vẫn giữ nguyên giá trị giữa bản người
 * dùng đã nhìn (`before`) và bản server hiện tại (`canonical`) — tức không ai sửa
 * cùng trường. `custom_values` so từng khoá con. Có trường đã bị đổi thì trả
 * false: đè lên thay đổi của người khác là thứ kiểm tra `updated_at` sinh ra để chặn.
 */
export function canRetryAfterConflict(
  patch: Record<string, unknown>,
  before: Record<string, unknown>,
  canonical: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(patch)) {
    if (REQUEST_ONLY_KEYS.has(key)) continue;
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
    const columns = RELATED_COLUMNS_FOR_REQUEST_KEY[key] ?? [key];
    for (const column of columns) {
      // Trường không có trên hồ sơ thì không biết nó đổi hay chưa — không đoán.
      if (!(column in before) && !(column in canonical)) return false;
      if (!sameValue(before[column], canonical[column])) return false;
    }
  }
  return true;
}

/**
 * `carrier_id` = hãng đầu của `carrier_ids`, như trigger trong DB làm. Thiếu
 * bước này thì bỏ tick hãng cuối cùng để lại `carrier_id` cũ trên dòng lạc
 * quan, và mọi chỗ rơi về `carrier_id` hiện lại đúng hãng vừa bỏ.
 */
function mirrorPrimaryCarrier(patch: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(patch.carrier_ids)) return patch;
  const first = patch.carrier_ids.find((id): id is string => typeof id === "string");
  return { ...patch, carrier_id: first ?? null };
}

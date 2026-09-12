import {
  formatAttachmentSize,
  TASK_ATTACHMENT_MAX_BYTES,
} from "./attachments";

/**
 * Trần cho MỘT bình luận (hoặc một lượt đính kèm thẳng vào task).
 *
 * `maxFiles` và `maxAggregateBytes` phải được chỉnh CÙNG NHAU. Aggregate được
 * kiểm trước count (xem checkOperationLimits), nên trần dung lượng thấp sẽ âm
 * thầm vô hiệu hoá trần số file: để maxFiles = 50 mà aggregate = 50MB thì mỗi
 * file chỉ được trung bình 1MB — ảnh chụp điện thoại 2-5MB sẽ bị chặn ở khoảng
 * 10-25 tấm, kèm thông báo "quá dung lượng" chứ không phải "quá số lượng", và
 * con số 50 kia thành vô nghĩa.
 *
 * 250MB = 50 tệp × 5MB, tức cỡ ảnh điện thoại thông thường. Trần mỗi tệp vẫn
 * giữ 15MB (TASK_ATTACHMENT_MAX_BYTES), nên vẫn không ai tải nổi 50 × 15MB.
 *
 * Tải lên là MỖI TỆP MỘT REQUEST, và server kiểm lại tổng dung lượng của những
 * tệp đã lưu cho bình luận đó — nâng aggregate không tạo ra request khổng lồ
 * nào, chỉ là tổng cho phép nhiều hơn.
 */
export const LIMITS = {
  maxTextLength: 10_000,
  maxFiles: 50,
  maxAggregateBytes: 250 * 1024 * 1024,
} as const;

export type LimitFailure = {
  ok: false;
  limit: "text" | "count" | "aggregate" | "per_file";
  message: string;
};

function aggregateSizeMessage() {
  return formatAttachmentSize(LIMITS.maxAggregateBytes).replace(".0MB", "MB");
}

/**
 * Check limits in deterministic order. Aggregate is checked before count and
 * per-file because ten maximum-size files can exceed the aggregate by 3x.
 */
export function checkOperationLimits(input: {
  textLength: number;
  sizes: readonly number[];
}): { ok: true } | LimitFailure {
  if (input.textLength > LIMITS.maxTextLength) {
    return {
      ok: false,
      limit: "text",
      message: `Comment is too long (max ${LIMITS.maxTextLength.toLocaleString()} characters).`,
    };
  }
  const total = input.sizes.reduce((sum, size) => sum + Math.max(0, size), 0);
  if (total > LIMITS.maxAggregateBytes) {
    return {
      ok: false,
      limit: "aggregate",
      message: `Attachments are too large in total (max ${aggregateSizeMessage()}).`,
    };
  }
  if (input.sizes.length > LIMITS.maxFiles) {
    return {
      ok: false,
      limit: "count",
      message: `Too many files (max ${LIMITS.maxFiles} per comment).`,
    };
  }
  if (input.sizes.some((size) => size > TASK_ATTACHMENT_MAX_BYTES)) {
    return {
      ok: false,
      limit: "per_file",
      message: `File too large (max ${formatAttachmentSize(TASK_ATTACHMENT_MAX_BYTES)}).`,
    };
  }
  return { ok: true };
}

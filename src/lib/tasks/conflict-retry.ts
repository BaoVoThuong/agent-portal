import {
  canRetryAfterConflict,
  type ConflictRetryTables,
} from "@/lib/collaboration/conflict-retry";

/**
 * Bảng khoá cho lượt sửa Task (`patchTask` ở TaskBoardClient). Đổi `status` kéo
 * theo `closed_at`; kéo thả đổi `position` trong cột `status`; `done_reviewed`
 * chỉ có trong request, server dịch thành `done_reviewed_at`/`_by_email` (như
 * `buildOptimisticTaskPatch` làm ở client).
 */
const TASK_CONFLICT_RETRY_TABLES: ConflictRetryTables = {
  requestOnlyKeys: new Set(["expected_updated_at"]),
  relatedColumns: {
    status: ["status", "closed_at"],
    position: ["position", "status"],
    done_reviewed: ["done_reviewed_at", "done_reviewed_by_email", "status"],
  },
};

/**
 * Lượt sửa Task bị 409 có gửi lại được với bản mới nhất không: chỉ khi không ai
 * đổi các trường của lượt này (xem lib/collaboration/conflict-retry.ts). Trước
 * đây mọi 409 đều làm mất lượt sửa, kể cả khi `updated_at` chỉ bị đẩy lên vì
 * người khác comment.
 */
export function canRetryTaskPatchAfterConflict(
  patch: Record<string, unknown>,
  before: Record<string, unknown>,
  canonical: Record<string, unknown>,
): boolean {
  return canRetryAfterConflict(patch, before, canonical, TASK_CONFLICT_RETRY_TABLES);
}

/**
 * Lượt gán/bỏ gán bị 409: bản mới nhất đã đúng ý người dùng chưa (đã có, hoặc
 * đã không còn người đó). Đúng rồi thì coi như xong, không gửi lại.
 */
export function assigneeChangeAlreadyApplied(
  canonical: { assignees?: readonly string[] | null; assignee_email?: string | null },
  email: string,
  assigned: boolean,
): boolean {
  const target = email.trim().toLowerCase();
  const current = canonical.assignees ?? (canonical.assignee_email ? [canonical.assignee_email] : []);
  return current.some((value) => value.trim().toLowerCase() === target) === assigned;
}

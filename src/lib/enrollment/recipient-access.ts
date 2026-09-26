import { loadViewers, viewerSeesEnrollment } from "@/lib/notifications/audience";
import type { EnrollmentRecordWithStats } from "./types";

type ScopedRecord = Pick<
  EnrollmentRecordWithStats,
  "agent_email" | "caller_email" | "responsible_enroll_email" | "created_by_email"
>;

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Chỉ giữ những người nhận MỞ ĐƯỢC hồ sơ này, theo đúng luật của trang
 * Enrollment: account active, có quyền vào board, và hồ sơ nằm trong scope.
 *
 * Trước đây @mention nhận bất kỳ account active nào (S15). Tính theo LÔ (review
 * A P2-02); `insertEnrollmentNotifications` còn lọc lại lần cuối trên hồ sơ
 * HIỆN TẠI trong DB. Trả về email chữ thường, theo thứ tự đầu vào, đã khử trùng.
 */
export async function filterEnrollmentRecipientsWithAccess(
  record: ScopedRecord,
  emails: readonly (string | null | undefined)[]
): Promise<string[]> {
  const unique = [...new Set(emails.map(normalize).filter(Boolean))];
  if (unique.length === 0) return [];
  const viewers = await loadViewers(unique);
  return unique.filter((email) => {
    const viewer = viewers.get(email);
    return Boolean(viewer && viewerSeesEnrollment(email, viewer, record));
  });
}

import { grantsForAccess } from "@/lib/authz/principal";
import { getUserAccessByEmails } from "@/lib/rbac/access";
import { canAccessEnrollment, enrollmentActorFromGrants } from "./policy";
import { isRecordInScope, resolveEnrollmentScope } from "./scope";
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
 * Enrollment: account active, có quyền vào board, và hồ sơ nằm trong scope
 * (`resolveEnrollmentScope` + `isRecordInScope`).
 *
 * Trước đây @mention nhận bất kỳ account active nào, nên một người Accounting
 * được nhắc tên nhận thông báo kèm tên khách hàng trong khi mở hồ sơ thì 404
 * (S15). Trả về email chữ thường, theo thứ tự đầu vào, đã khử trùng.
 */
export async function filterEnrollmentRecipientsWithAccess(
  record: ScopedRecord,
  emails: readonly (string | null | undefined)[]
): Promise<string[]> {
  const unique = [...new Set(emails.map(normalize).filter(Boolean))];
  if (unique.length === 0) return [];

  const accessByEmail = await getUserAccessByEmails(unique);
  const decisions = await Promise.all(
    unique.map(async (email) => {
      const access = accessByEmail.get(email);
      if (!access || !access.isActive) return false;
      const actor = enrollmentActorFromGrants(email, await grantsForAccess(access));
      if (!canAccessEnrollment(actor)) return false;
      const scope = await resolveEnrollmentScope(actor);
      return isRecordInScope(scope, record);
    })
  );
  return unique.filter((_, index) => decisions[index]);
}

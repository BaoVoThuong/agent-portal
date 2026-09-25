import type { JWT } from "next-auth/jwt";
import type { UserAccess } from "@/lib/rbac/access";

/**
 * Ghép quyền vừa làm mới vào JWT.
 *
 * Account bị khoá hoặc đã xoá → `null`. Auth.js hiểu `null` là kết thúc phiên
 * (`@auth/core/lib/actions/session.js`: token === null → xoá cookie), và `auth()`
 * trả về null → mọi route coi như chưa đăng nhập. Trước đây phiên vẫn sống với
 * email nên chuông, đăng ký push và avatar vẫn chạy tới khi cookie hết hạn (S17).
 *
 * Truy vấn LỖI thì khác: giữ phiên nhưng rút hết quyền cho request này, và KHÔNG
 * đánh dấu đã làm mới để request sau thử lại. Coi lỗi là "đã khoá" thì một sự cố
 * database vài giây đăng xuất toàn công ty.
 */
export function applyRefreshedAccess(
  token: JWT,
  access: UserAccess,
  now: number,
  accessVersion: number | null = null
): JWT | null {
  if (access.lookupFailed) {
    return { ...token, role: "agent", roles: [], roleIds: [], permissions: [] };
  }
  if (!access.isActive) return null;
  return {
    ...token,
    accountId: access.userId,
    role: access.legacyRole,
    roles: access.roles,
    roleIds: access.roleIds,
    permissions: access.permissions,
    agentId: access.agentId,
    accessVersion: accessVersion ?? token.accessVersion ?? 0,
    rbacRefreshedAt: now,
  };
}

import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import type { UserRole } from "@/lib/domain/account.types";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  getDefaultSystemRoleName,
  getLegacyRoleFromRoleNames,
} from "@/lib/rbac/system-roles";

export type AccessRow = {
  id: string;
  email?: string | null;
  role: string | null;
  is_active: boolean | null;
  agent_id: string | null;
  user_roles:
    | { roles: { id: string; name: string; is_active: boolean; role_permissions: { permission_key: string }[] } | null }[]
    | null;
};

export type UserAccess = {
  userId: string | null;
  legacyRole: UserRole;
  roles: string[];
  /** Id của các role ĐANG hoạt động — nguồn để suy grant (authz/principal.ts). */
  roleIds: string[];
  permissions: string[];
  isActive: boolean;
  agentId: string | null;
  /** true khi truy vấn quyền LỖI — khác với "không có account". */
  lookupFailed: boolean;
};

const ACCESS_SELECT =
  "id,email,role,is_active,agent_id,user_roles(roles(id,name,is_active,role_permissions(permission_key)))";

function missingAccess(lookupFailed: boolean): UserAccess {
  return {
    userId: null,
    legacyRole: "agent",
    roles: [],
    roleIds: [],
    permissions: [],
    isActive: false,
    agentId: null,
    lookupFailed,
  };
}

export function flattenAccess(row: AccessRow): UserAccess {
  const legacyRole: UserRole = row.role === "admin" ? "admin" : "agent";
  if (row.is_active === false) {
    return { userId: row.id, legacyRole, roles: [], roleIds: [], permissions: [], isActive: false, agentId: row.agent_id ?? null, lookupFailed: false };
  }
  const activeRoles = (row.user_roles ?? [])
    .map((ur) => ur.roles)
    .filter((r): r is NonNullable<typeof r> => Boolean(r) && r!.is_active);
  const roleNames = activeRoles.map((r) => r.name);
  const permissions = [
    ...new Set(activeRoles.flatMap((r) => r.role_permissions.map((p) => p.permission_key))),
  ];
  return {
    userId: row.id,
    // Either source may say admin. portal_account.role is normally a mirror of
    // the RBAC roles — /api/admin/users writes it from getLegacyRoleFromRoleNames
    // — so today the two always agree. Computing legacyRole from row.role on the
    // line above and then discarding it here was a trap: a row edited straight
    // in the database would silently not count as admin anywhere.
    legacyRole:
      legacyRole === "admin" ? "admin" : getLegacyRoleFromRoleNames(roleNames),
    roles: roleNames,
    roleIds: activeRoles.map((r) => r.id),
    permissions,
    isActive: true,
    agentId: row.agent_id ?? null,
    lookupFailed: false,
  };
}

/**
 * Quyền hiện tại của một account.
 *
 * Có `accountId` thì tra theo id (bất biến) và đòi email trong phiên phải khớp
 * email hiện tại của account; lệch nghĩa là email đã đổi/tái dùng, và phiên cũ
 * không được nhận quyền của account đang giữ email đó (audit S20). Không có id
 * (phiên cũ, lần đầu đăng nhập Google) thì tra theo email.
 */
export async function getUserAccess(identity: {
  accountId?: string | null;
  email: string;
}): Promise<UserAccess> {
  const base = getSupabaseAdmin().from(PORTAL_ACCOUNT_TABLE).select(ACCESS_SELECT);
  const { data, error } = await (identity.accountId
    ? base.eq("id", identity.accountId)
    : base.eq("email", identity.email)
  ).maybeSingle();

  if (error) return missingAccess(true);
  if (!data) return missingAccess(false);

  const row = data as unknown as AccessRow;
  if (
    identity.accountId &&
    (row.email ?? "").trim().toLowerCase() !== identity.email.trim().toLowerCase()
  ) {
    return missingAccess(false);
  }
  return flattenAccess(row);
}

export async function getUserAccessByEmail(email: string): Promise<UserAccess> {
  return getUserAccess({ email });
}

/**
 * Quyền của nhiều account trong MỘT truy vấn — dùng khi lọc người nhận thông
 * báo. Khoá của Map là email chữ thường. Ném lỗi khi truy vấn lỗi để nơi gọi
 * fail-closed (không gửi) thay vì gửi mò.
 */
export async function getUserAccessByEmails(
  emails: readonly string[]
): Promise<Map<string, UserAccess>> {
  const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const result = new Map<string, UserAccess>();
  if (unique.length === 0) return result;

  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select(ACCESS_SELECT)
    .in("email", unique);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as unknown as (AccessRow & { email: string })[]) {
    result.set(row.email.trim().toLowerCase(), flattenAccess(row));
  }
  return result;
}

/**
 * Gán role mặc định cho account vừa tự tạo (đăng nhập Google lần đầu). Tìm role
 * theo `system_key` (rơi về tên khi rollout Phase C chưa chạy) và KHÔNG nuốt lỗi
 * nữa: trước đây lỗi ở đây để lại account không có role mà không ai biết (S19).
 */
export async function assignDefaultRoleToUser(
  userId: string,
  legacyRole: UserRole
) {
  const supabase = getSupabaseAdmin();
  const systemKey = legacyRole === "admin" ? "super_admin" : "default_new_account";
  const byKey = await supabase.from("roles").select("id").eq("system_key", systemKey).maybeSingle();
  let roleId = byKey.error ? null : (byKey.data as { id: string } | null)?.id ?? null;
  if (byKey.error) {
    const byName = await supabase
      .from("roles")
      .select("id")
      .eq("name", getDefaultSystemRoleName(legacyRole))
      .maybeSingle();
    if (byName.error) throw new Error(byName.error.message);
    roleId = (byName.data as { id: string } | null)?.id ?? null;
  }
  if (!roleId) throw new Error(`Default role "${systemKey}" not found.`);

  const { error: deleteError } = await supabase.from("user_roles").delete().eq("user_id", userId);
  if (deleteError) throw new Error(deleteError.message);
  const { error: insertError } = await supabase.from("user_roles").insert({
    user_id: userId,
    role_id: roleId,
  });
  if (insertError) throw new Error(insertError.message);
}

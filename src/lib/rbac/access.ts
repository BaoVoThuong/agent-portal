import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import type { UserRole } from "@/lib/domain/account.types";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  getDefaultSystemRoleName,
  getLegacyRoleFromRoleNames,
} from "@/lib/rbac/system-roles";

export type AccessRow = {
  id: string;
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
  permissions: string[];
  isActive: boolean;
  agentId: string | null;
  /** true khi truy vấn quyền LỖI — khác với "không có account". */
  lookupFailed: boolean;
};

export function flattenAccess(row: AccessRow): UserAccess {
  const legacyRole: UserRole = row.role === "admin" ? "admin" : "agent";
  if (row.is_active === false) {
    return { userId: row.id, legacyRole, roles: [], permissions: [], isActive: false, agentId: row.agent_id ?? null, lookupFailed: false };
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
    permissions,
    isActive: true,
    agentId: row.agent_id ?? null,
    lookupFailed: false,
  };
}

export async function getUserAccessByEmail(email: string): Promise<UserAccess> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select(
      "id,role,is_active,agent_id,user_roles(roles(id,name,is_active,role_permissions(permission_key)))"
    )
    .eq("email", email)
    .maybeSingle();

  if (error) {
    return { userId: null, legacyRole: "agent", roles: [], permissions: [], isActive: false, agentId: null, lookupFailed: true };
  }
  if (!data) {
    return { userId: null, legacyRole: "agent", roles: [], permissions: [], isActive: false, agentId: null, lookupFailed: false };
  }
  return flattenAccess(data as unknown as AccessRow);
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
    .select(
      "id,email,role,is_active,agent_id,user_roles(roles(id,name,is_active,role_permissions(permission_key)))"
    )
    .in("email", unique);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as unknown as (AccessRow & { email: string })[]) {
    result.set(row.email.trim().toLowerCase(), flattenAccess(row));
  }
  return result;
}

export async function assignDefaultRoleToUser(
  userId: string,
  legacyRole: UserRole
) {
  const supabase = getSupabaseAdmin();
  const roleName = getDefaultSystemRoleName(legacyRole);
  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("id")
    .eq("name", roleName)
    .maybeSingle();

  if (roleError || !role) return;

  await supabase.from("user_roles").delete().eq("user_id", userId);
  await supabase.from("user_roles").insert({
    user_id: userId,
    role_id: (role as { id: string }).id,
  });
}

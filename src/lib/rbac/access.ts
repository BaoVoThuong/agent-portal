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
};

export function flattenAccess(row: AccessRow): UserAccess {
  const legacyRole: UserRole = row.role === "admin" ? "admin" : "agent";
  if (row.is_active === false) {
    return { userId: row.id, legacyRole, roles: [], permissions: [], isActive: false, agentId: row.agent_id ?? null };
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
    legacyRole: getLegacyRoleFromRoleNames(roleNames),
    roles: roleNames,
    permissions,
    isActive: true,
    agentId: row.agent_id ?? null,
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

  if (error || !data) {
    return { userId: null, legacyRole: "agent", roles: [], permissions: [], isActive: false, agentId: null };
  }
  return flattenAccess(data as unknown as AccessRow);
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

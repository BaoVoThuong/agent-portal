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

type PortalAccountRow = {
  id: string;
  email: string;
  role: string | null;
  is_active: boolean | null;
};

type UserRoleRow = {
  role_id: string;
};

type RoleRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type RolePermissionRow = {
  permission_key: string;
};

function emptyAccess(
  user: PortalAccountRow | null,
  legacyRole: UserRole = "agent"
): UserAccess {
  return {
    userId: user?.id ?? null,
    legacyRole,
    roles: [],
    permissions: [],
    isActive: user?.is_active !== false,
    agentId: null,
  };
}

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
  const { data: user, error: userError } = await supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id,email,role,is_active")
    .eq("email", email)
    .single();

  if (userError || !user) {
    return {
      userId: null,
      legacyRole: "agent",
      roles: [],
      permissions: [],
      isActive: false,
      agentId: null,
    };
  }

  const account = user as unknown as PortalAccountRow;
  const legacyRole: UserRole = account.role === "admin" ? "admin" : "agent";

  if (account.is_active === false) {
    return {
      userId: account.id,
      legacyRole,
      roles: [],
      permissions: [],
      isActive: false,
      agentId: null,
    };
  }

  const { data: userRoleRows, error: userRolesError } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", account.id);

  if (userRolesError) return emptyAccess(account, legacyRole);

  const roleIds = [
    ...new Set(
      ((userRoleRows ?? []) as unknown as UserRoleRow[]).map((row) => row.role_id)
    ),
  ];

  if (roleIds.length === 0) return emptyAccess(account, legacyRole);

  const { data: rolesData, error: rolesError } = await supabase
    .from("roles")
    .select("id,name,is_active")
    .in("id", roleIds)
    .eq("is_active", true);

  if (rolesError) return emptyAccess(account, legacyRole);

  const roles = (rolesData ?? []) as unknown as RoleRow[];
  const activeRoleIds = roles.map((role) => role.id);

  if (activeRoleIds.length === 0) {
    return emptyAccess(account, legacyRole);
  }

  const { data: rolePermissionRows, error: permissionsError } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .in("role_id", activeRoleIds);

  if (permissionsError) return emptyAccess(account, legacyRole);

  const permissionKeys = [
    ...new Set(
      ((rolePermissionRows ?? []) as unknown as RolePermissionRow[]).map(
        (row) => row.permission_key
      )
    ),
  ];
  const roleNames = roles.map((role) => role.name);

  return {
    userId: account.id,
    legacyRole: getLegacyRoleFromRoleNames(roleNames),
    roles: roleNames,
    permissions: permissionKeys,
    isActive: true,
    agentId: null,
  };
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

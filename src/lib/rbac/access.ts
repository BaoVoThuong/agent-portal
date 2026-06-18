import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import type { UserRole } from "@/lib/domain/account.types";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  getDefaultSystemRoleName,
  getLegacyRoleFromRoleNames,
} from "@/lib/rbac/system-roles";

export type UserAccess = {
  userId: string | null;
  legacyRole: UserRole;
  roles: string[];
  permissions: string[];
  isActive: boolean;
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

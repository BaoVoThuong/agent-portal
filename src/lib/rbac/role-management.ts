import { getSupabaseAdmin } from "@/lib/supabase";
import { isAssignablePermissionKey, normalizeExclusivePermissionKeys } from "@/lib/rbac/permissions";
import { isAdminRoleName } from "@/lib/rbac/admin-role";

export type PermissionRecord = {
  key: string;
  label: string;
  group_key: string;
  group_label: string;
  description: string | null;
  sort_order: number;
};

export type RoleHolder = {
  user_id: string;
  name: string | null;
  email: string;
  is_active: boolean;
  agent_id: string | null;
  position_id: string | null;
  manager_id: string | null;
};

type HolderAccount = Pick<
  RoleHolder,
  "name" | "email" | "is_active" | "agent_id" | "position_id" | "manager_id"
>;

export type RoleRecord = {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Active accounts holding the role. */
  user_count: number;
  /**
   * Every account holding the role, disabled ones included. Deleting a role
   * must move all of them to another role first (user_roles cascades).
   */
  holders: RoleHolder[];
  permissions: PermissionRecord[];
};

type RoleRow = Omit<RoleRecord, "user_count" | "holders" | "permissions">;

type RolePermissionRow = {
  role_id: string;
  permission_key: string;
};

type UserRoleRow = {
  user_id: string;
  role_id: string;
  created_at: string | null;
  portal_account: HolderAccount | null;
};

export type RoleOption = Pick<
  RoleRecord,
  "id" | "name" | "description" | "is_system" | "is_active"
>;

const ROLE_COLUMNS = "id,name,description,is_system,is_active,created_at,updated_at";

export async function fetchPermissions() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("permissions")
    .select("key,label,group_key,group_label,description,sort_order")
    .order("group_key", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as PermissionRecord[]).filter((permission) =>
    isAssignablePermissionKey(permission.key)
  );
}

export async function fetchRolesWithPermissions() {
  const supabase = getSupabaseAdmin();
  const [rolesResponse, permissions, rolePermissionsResponse, userRolesResponse] =
    await Promise.all([
      supabase
        .from("roles")
        .select(ROLE_COLUMNS)
        .order("is_system", { ascending: false })
        .order("name", { ascending: true }),
      fetchPermissions(),
      supabase.from("role_permissions").select("role_id,permission_key"),
      supabase
        .from("user_roles")
        .select(
          "user_id,role_id,created_at, portal_account!inner(name,email,is_active,agent_id,position_id,manager_id)"
        ),
    ]);

  if (rolesResponse.error) throw new Error(rolesResponse.error.message);
  if (rolePermissionsResponse.error) {
    throw new Error(rolePermissionsResponse.error.message);
  }
  if (userRolesResponse.error) throw new Error(userRolesResponse.error.message);

  const roles = (rolesResponse.data ?? []) as unknown as RoleRow[];
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const permissionByKey = new Map(
    permissions.map((permission) => [permission.key, permission])
  );
  const permissionKeysByRoleId = new Map<string, string[]>();
  for (const row of (rolePermissionsResponse.data ??
    []) as unknown as RolePermissionRow[]) {
    const current = permissionKeysByRoleId.get(row.role_id) ?? [];
    current.push(row.permission_key);
    permissionKeysByRoleId.set(row.role_id, current);
  }

  const userRoleRows = (userRolesResponse.data ?? []) as unknown as UserRoleRow[];

  // user_count keeps its meaning: active accounts only.
  const selectedRoleByUserId = new Map<string, UserRoleRow>();
  for (const row of userRoleRows) {
    if (!row.portal_account?.is_active) continue;
    const current = selectedRoleByUserId.get(row.user_id);

    if (!current || compareUserRolePriority(row, current, roleById) < 0) {
      selectedRoleByUserId.set(row.user_id, row);
    }
  }

  const userCountByRoleId = new Map<string, number>();
  for (const row of selectedRoleByUserId.values()) {
    userCountByRoleId.set(
      row.role_id,
      (userCountByRoleId.get(row.role_id) ?? 0) + 1
    );
  }

  const holdersByRoleId = new Map<string, RoleHolder[]>();
  for (const row of userRoleRows) {
    if (!row.portal_account) continue;
    const current = holdersByRoleId.get(row.role_id) ?? [];
    current.push({ user_id: row.user_id, ...row.portal_account });
    holdersByRoleId.set(row.role_id, current);
  }

  return roles
    .map((role) => ({
      ...role,
      user_count: userCountByRoleId.get(role.id) ?? 0,
      holders: sortRoleHolders(holdersByRoleId.get(role.id) ?? []),
      permissions: normalizeExclusivePermissionKeys(
        permissionKeysByRoleId.get(role.id) ?? []
      )
        .map((key) => permissionByKey.get(key))
        .filter((permission): permission is PermissionRecord => Boolean(permission))
        .sort(
          (a, b) =>
            a.group_key.localeCompare(b.group_key) ||
            a.sort_order - b.sort_order ||
            a.label.localeCompare(b.label)
        ),
    }))
    .sort((firstRole, secondRole) => {
      const firstIsAdmin = isAdminRoleName(firstRole.name);
      const secondIsAdmin = isAdminRoleName(secondRole.name);

      if (firstIsAdmin !== secondIsAdmin) return firstIsAdmin ? -1 : 1;
      if (firstRole.is_system !== secondRole.is_system) {
        return firstRole.is_system ? -1 : 1;
      }

      return firstRole.name.localeCompare(secondRole.name);
    });
}

function compareUserRolePriority(
  firstRow: UserRoleRow,
  secondRow: UserRoleRow,
  roleById: Map<string, RoleRow>
) {
  const firstRole = roleById.get(firstRow.role_id);
  const secondRole = roleById.get(secondRow.role_id);
  const firstIsAdmin = isAdminRoleName(firstRole?.name);
  const secondIsAdmin = isAdminRoleName(secondRole?.name);

  if (firstIsAdmin !== secondIsAdmin) return firstIsAdmin ? -1 : 1;

  const firstCreatedAt = firstRow.created_at ?? "";
  const secondCreatedAt = secondRow.created_at ?? "";
  if (firstCreatedAt !== secondCreatedAt) {
    return firstCreatedAt.localeCompare(secondCreatedAt);
  }

  return (firstRole?.name ?? "").localeCompare(secondRole?.name ?? "");
}

/** Active accounts first, then by display name (email when there is none). */
function sortRoleHolders(holders: RoleHolder[]): RoleHolder[] {
  return [...holders].sort(
    (first, second) =>
      Number(second.is_active) - Number(first.is_active) ||
      (first.name?.trim() || first.email).localeCompare(second.name?.trim() || second.email)
  );
}

export async function fetchRoleById(roleId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("roles")
    .select(ROLE_COLUMNS)
    .eq("id", roleId)
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as RoleRow;
}

/** Every account holding the role, disabled ones included. */
export async function countUsersForRole(roleId: string) {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("user_roles")
    .select("role_id", { count: "exact", head: true })
    .eq("role_id", roleId);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchActiveRolesByIds(roleIds: string[]) {
  const uniqueRoleIds = [...new Set(roleIds)];
  if (uniqueRoleIds.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("roles")
    .select(ROLE_COLUMNS)
    .in("id", uniqueRoleIds)
    .eq("is_active", true);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RoleRow[];
}

export async function replaceUserRoles(userId: string, roleIds: string[]) {
  const supabase = getSupabaseAdmin();
  const selectedRoleId = roleIds[0];

  const { error } = await supabase.rpc("replace_user_roles", {
    target_user_id: userId,
    role_ids: selectedRoleId ? [selectedRoleId] : [],
  });

  if (error) throw new Error(error.message);
}

/** Permission keys stored on one role. */
export async function fetchRolePermissionKeys(roleId: string): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role_id", roleId);
  if (error) throw new Error(error.message);
  return [
    ...new Set(((data ?? []) as { permission_key: string }[]).map((row) => row.permission_key)),
  ];
}

/**
 * Permission keys an account holds through its ACTIVE roles. Deliberately
 * ignores portal_account.is_active: a disabled account must stay protected,
 * or someone could re-enable it and reset its password.
 */
export async function fetchUserPermissionKeys(userId: string): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_roles")
    .select("roles(is_active,role_permissions(permission_key))")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<{
    roles: { is_active: boolean; role_permissions: { permission_key: string }[] } | null;
  }>;
  return [
    ...new Set(
      rows.flatMap((row) =>
        row.roles?.is_active ? row.roles.role_permissions.map((p) => p.permission_key) : []
      )
    ),
  ];
}

export async function fetchUserPermissionKeysByEmail(email: string): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("portal_account")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return [];
  return fetchUserPermissionKeys((data as { id: string }).id);
}

/** Current role id of an account (an account holds at most one role). */
export async function fetchUserRoleId(userId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { role_id: string } | null)?.role_id ?? null;
}

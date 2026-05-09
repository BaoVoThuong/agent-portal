import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeExclusivePermissionKeys } from "@/lib/rbac/permissions";
import {
  LEGACY_SUPER_ADMIN_ROLE_NAME,
  SYSTEM_ROLE_NAMES,
} from "@/lib/rbac/system-roles";

export type PermissionRecord = {
  key: string;
  label: string;
  group_key: string;
  group_label: string;
  description: string | null;
  sort_order: number;
};

export type RoleRecord = {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_count: number;
  permissions: PermissionRecord[];
};

type RoleRow = Omit<RoleRecord, "user_count" | "permissions">;

type RolePermissionRow = {
  role_id: string;
  permission_key: string;
};

type UserRoleRow = {
  user_id: string;
  role_id: string;
  created_at: string | null;
};

type UserRoleWithUserRow = {
  user_id: string;
  portal_account: { is_active: boolean | null } | null;
};

export type RoleOption = Pick<
  RoleRecord,
  "id" | "name" | "description" | "is_system" | "is_active"
>;

export async function fetchPermissions() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("permissions")
    .select("key,label,group_key,group_label,description,sort_order")
    .order("group_key", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PermissionRecord[];
}

export async function fetchRolesWithPermissions() {
  const supabase = getSupabaseAdmin();
  const [rolesResponse, permissions, rolePermissionsResponse, userRolesResponse] =
    await Promise.all([
      supabase
        .from("roles")
        .select("id,name,description,is_system,is_active,created_at,updated_at")
        .order("is_system", { ascending: false })
        .order("name", { ascending: true }),
      fetchPermissions(),
      supabase.from("role_permissions").select("role_id,permission_key"),
      supabase
        .from("user_roles")
        .select("user_id,role_id,created_at, portal_account!inner(is_active)")
        .eq("portal_account.is_active", true),
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

  const selectedRoleByUserId = new Map<string, UserRoleRow>();
  for (const row of (userRolesResponse.data ?? []) as unknown as UserRoleRow[]) {
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

  return roles
    .map((role) => ({
      ...role,
      user_count: userCountByRoleId.get(role.id) ?? 0,
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
      const firstIsAdmin =
        firstRole.name === SYSTEM_ROLE_NAMES.SUPER_ADMIN ||
        firstRole.name === LEGACY_SUPER_ADMIN_ROLE_NAME;
      const secondIsAdmin =
        secondRole.name === SYSTEM_ROLE_NAMES.SUPER_ADMIN ||
        secondRole.name === LEGACY_SUPER_ADMIN_ROLE_NAME;

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
  const firstIsAdmin =
    firstRole?.name === SYSTEM_ROLE_NAMES.SUPER_ADMIN ||
    firstRole?.name === LEGACY_SUPER_ADMIN_ROLE_NAME;
  const secondIsAdmin =
    secondRole?.name === SYSTEM_ROLE_NAMES.SUPER_ADMIN ||
    secondRole?.name === LEGACY_SUPER_ADMIN_ROLE_NAME;

  if (firstIsAdmin !== secondIsAdmin) return firstIsAdmin ? -1 : 1;

  const firstCreatedAt = firstRow.created_at ?? "";
  const secondCreatedAt = secondRow.created_at ?? "";
  if (firstCreatedAt !== secondCreatedAt) {
    return firstCreatedAt.localeCompare(secondCreatedAt);
  }

  return (firstRole?.name ?? "").localeCompare(secondRole?.name ?? "");
}

export async function replaceRolePermissions(
  roleId: string,
  permissionKeys: string[]
) {
  const supabase = getSupabaseAdmin();
  const uniquePermissionKeys = [...new Set(permissionKeys)];

  const { error } = await supabase.rpc("replace_role_permissions", {
    target_role_id: roleId,
    permission_keys: uniquePermissionKeys,
  });

  if (error) throw new Error(error.message);
}

export async function fetchRoleById(roleId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("roles")
    .select("id,name,description,is_system,is_active,created_at,updated_at")
    .eq("id", roleId)
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as RoleRow;
}

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
    .select("id,name,description,is_system,is_active,created_at,updated_at")
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

export async function countActiveUsersForRoleName(
  roleName: string,
  excludeUserId?: string
) {
  const supabase = getSupabaseAdmin();
  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("id")
    .eq("name", roleName)
    .maybeSingle();

  if (roleError) throw new Error(roleError.message);
  if (!role) return 0;

  let query = supabase
    .from("user_roles")
    .select("user_id, portal_account!inner(is_active)")
    .eq("role_id", (role as { id: string }).id)
    .eq("portal_account.is_active", true);

  if (excludeUserId) {
    query = query.neq("user_id", excludeUserId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as UserRoleWithUserRow[]).filter(
    (row) => row.portal_account?.is_active !== false
  ).length;
}

export async function hasActiveSuperAdminOtherThan(userId: string) {
  return (
    (await countActiveUsersForRoleName(SYSTEM_ROLE_NAMES.SUPER_ADMIN, userId)) +
      (await countActiveUsersForRoleName(LEGACY_SUPER_ADMIN_ROLE_NAME, userId)) >
    0
  );
}

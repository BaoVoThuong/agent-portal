import { getSupabaseAdmin } from "@/lib/supabase";
import { SYSTEM_ROLE_NAMES } from "@/lib/rbac/system-roles";

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
  role_id: string;
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
        .select("role_id, portal_account!inner(is_active)")
        .eq("portal_account.is_active", true),
    ]);

  if (rolesResponse.error) throw new Error(rolesResponse.error.message);
  if (rolePermissionsResponse.error) {
    throw new Error(rolePermissionsResponse.error.message);
  }
  if (userRolesResponse.error) throw new Error(userRolesResponse.error.message);

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

  const userCountByRoleId = new Map<string, number>();
  for (const row of (userRolesResponse.data ?? []) as unknown as UserRoleRow[]) {
    userCountByRoleId.set(row.role_id, (userCountByRoleId.get(row.role_id) ?? 0) + 1);
  }

  return ((rolesResponse.data ?? []) as unknown as RoleRow[]).map((role) => ({
    ...role,
    user_count: userCountByRoleId.get(role.id) ?? 0,
    permissions: (permissionKeysByRoleId.get(role.id) ?? [])
      .map((key) => permissionByKey.get(key))
      .filter((permission): permission is PermissionRecord => Boolean(permission))
      .sort(
        (a, b) =>
          a.group_key.localeCompare(b.group_key) ||
          a.sort_order - b.sort_order ||
          a.label.localeCompare(b.label)
      ),
  }));
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
  const uniqueRoleIds = [...new Set(roleIds)];

  const { error } = await supabase.rpc("replace_user_roles", {
    target_user_id: userId,
    role_ids: uniqueRoleIds,
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
    (await countActiveUsersForRoleName(SYSTEM_ROLE_NAMES.SUPER_ADMIN, userId)) > 0
  );
}

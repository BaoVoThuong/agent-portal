import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeExclusivePermissionKeys } from "@/lib/rbac/permissions";
import {
  LEGACY_SUPER_ADMIN_ROLE_NAME,
  SYSTEM_ROLE_NAMES,
} from "@/lib/rbac/system-roles";
import {
  effectiveRoleGrants,
  fetchRoleDefinitions,
  grantsForRoles,
  roleDefinitionFromRow,
  type RoleRow,
} from "@/lib/authz/principal";

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
  /** Định danh bất biến của role hệ thống; `undefined` khi rollout Phase C chưa chạy. */
  system_key?: string | null;
  /** Role đã chuyển sang grant tường minh (Role Manager dạng lưới). */
  grants_managed: boolean;
  created_at: string;
  updated_at: string;
  user_count: number;
  /** Bản chiếu permission phẳng (hoặc permission gốc nếu role chưa chuyển). */
  permissions: PermissionRecord[];
  /** Grant HIỆU LỰC — tường minh hoặc suy tương thích. */
  grants: string[];
};

export type RoleOption = Pick<
  RoleRecord,
  "id" | "name" | "description" | "is_system" | "is_active" | "system_key"
>;

export const SYSTEM_ROLE_KEYS = {
  SUPER_ADMIN: "super_admin",
  DEFAULT_NEW_ACCOUNT: "default_new_account",
} as const;

/**
 * Role admin khôi phục. Sau rollout Phase C chỉ nhìn `system_key`; trước đó
 * (cột chưa có → `undefined`) mới rơi về so tên như cũ.
 */
export function isSuperAdminRole(role: { name: string; system_key?: string | null }): boolean {
  if (role.system_key !== undefined) return role.system_key === SYSTEM_ROLE_KEYS.SUPER_ADMIN;
  return role.name === SYSTEM_ROLE_NAMES.SUPER_ADMIN || role.name === LEGACY_SUPER_ADMIN_ROLE_NAME;
}

/** Role hệ thống (có system_key) không xoá được. */
export function isSystemRole(role: { name: string; system_key?: string | null }): boolean {
  if (role.system_key !== undefined) return role.system_key !== null;
  return isSuperAdminRole(role) || role.name === SYSTEM_ROLE_NAMES.AGENT;
}

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

type RoleListRow = RoleRow & {
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

const ROLE_LIST_SELECT =
  "id,name,description,is_system,is_active,created_at,updated_at,system_key,grants_managed,role_permissions(permission_key),role_grants(action,scope)";
const ROLE_LIST_SELECT_LEGACY =
  "id,name,description,is_system,is_active,created_at,updated_at,role_permissions(permission_key)";

async function fetchRoleListRows(): Promise<RoleListRow[]> {
  const supabase = getSupabaseAdmin();
  const first = await supabase.from("roles").select(ROLE_LIST_SELECT);
  if (!first.error) return (first.data ?? []) as unknown as RoleListRow[];
  if (!/role_grants|grants_managed|system_key/.test(first.error.message)) {
    throw new Error(first.error.message);
  }
  const fallback = await supabase.from("roles").select(ROLE_LIST_SELECT_LEGACY);
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []) as unknown as RoleListRow[];
}

export async function fetchRolesWithPermissions(): Promise<RoleRecord[]> {
  const supabase = getSupabaseAdmin();
  const [rows, permissions, userRolesResponse] = await Promise.all([
    fetchRoleListRows(),
    fetchPermissions(),
    supabase
      .from("user_roles")
      .select("user_id,role_id, portal_account!inner(is_active)")
      .eq("portal_account.is_active", true),
  ]);
  if (userRolesResponse.error) throw new Error(userRolesResponse.error.message);

  const permissionByKey = new Map(permissions.map((permission) => [permission.key, permission]));
  const userCountByRoleId = new Map<string, number>();
  for (const row of (userRolesResponse.data ?? []) as unknown as { role_id: string }[]) {
    userCountByRoleId.set(row.role_id, (userCountByRoleId.get(row.role_id) ?? 0) + 1);
  }

  return rows
    .map((row): RoleRecord => {
      const definition = roleDefinitionFromRow(row);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        is_system: row.is_system,
        is_active: row.is_active,
        ...("system_key" in row ? { system_key: row.system_key ?? null } : {}),
        grants_managed: Boolean(row.grants_managed),
        created_at: row.created_at,
        updated_at: row.updated_at,
        user_count: userCountByRoleId.get(row.id) ?? 0,
        permissions: normalizeExclusivePermissionKeys(definition.permissions)
          .map((key) => permissionByKey.get(key))
          .filter((permission): permission is PermissionRecord => Boolean(permission))
          .sort(
            (a, b) =>
              a.group_key.localeCompare(b.group_key) ||
              a.sort_order - b.sort_order ||
              a.label.localeCompare(b.label)
          ),
        grants: effectiveRoleGrants(definition),
      };
    })
    .sort((first, second) => {
      const firstAdmin = isSuperAdminRole(first);
      const secondAdmin = isSuperAdminRole(second);
      if (firstAdmin !== secondAdmin) return firstAdmin ? -1 : 1;
      if (first.is_system !== second.is_system) return first.is_system ? -1 : 1;
      return first.name.localeCompare(second.name);
    });
}

/** Định nghĩa một role (kèm grant), đọc tươi — null nếu không tồn tại. */
export async function fetchRoleDefinition(roleId: string) {
  return (await fetchRoleDefinitions([roleId])).get(roleId) ?? null;
}

/** Id của role hệ thống theo system_key (rơi về tên khi rollout chưa chạy). */
export async function fetchSystemRoleId(
  key: (typeof SYSTEM_ROLE_KEYS)[keyof typeof SYSTEM_ROLE_KEYS]
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const byKey = await supabase.from("roles").select("id").eq("system_key", key).maybeSingle();
  if (!byKey.error) return (byKey.data as { id: string } | null)?.id ?? null;
  const name = key === SYSTEM_ROLE_KEYS.SUPER_ADMIN ? SYSTEM_ROLE_NAMES.SUPER_ADMIN : SYSTEM_ROLE_NAMES.AGENT;
  const byName = await supabase.from("roles").select("id").eq("name", name).maybeSingle();
  if (byName.error) throw new Error(byName.error.message);
  return (byName.data as { id: string } | null)?.id ?? null;
}

/**
 * Grant hiệu lực của một account — để Account Manager áp trần uỷ quyền lên
 * người bị sửa (không quản được người có quyền cao hơn mình).
 */
export async function fetchAccountAccess(accountId: string): Promise<{
  roleIds: string[];
  grants: string[];
  holdsSuperAdmin: boolean;
}> {
  const supabase = getSupabaseAdmin();
  const [{ data: account, error: accountError }, { data: userRoles, error: rolesError }] =
    await Promise.all([
      supabase.from("portal_account").select("role").eq("id", accountId).maybeSingle(),
      supabase.from("user_roles").select("role_id").eq("user_id", accountId),
    ]);
  if (accountError) throw new Error(accountError.message);
  if (rolesError) throw new Error(rolesError.message);
  const roleIds = ((userRoles ?? []) as { role_id: string }[]).map((row) => row.role_id);
  const roles = [...(await fetchRoleDefinitions(roleIds)).values()];
  const legacyRole = (account as { role?: string } | null)?.role ?? "agent";
  return {
    roleIds,
    grants: grantsForRoles(roles, legacyRole),
    holdsSuperAdmin: roles.some(
      (role) => role.isActive && isSuperAdminRole({ name: role.name, system_key: role.systemKey })
    ),
  };
}

/** Lỗi nghiệp vụ từ các RPC Phase C → HTTP. */
export function mapAuthzRpcError(message: string | undefined): { status: number; error: string } | null {
  switch (message) {
    case "ROLE_NAME_REQUIRED":
      return { status: 400, error: "Role name is required." };
    case "ROLE_NAME_RESERVED":
      return { status: 400, error: "This role name is reserved for the system Admin role." };
    case "ROLE_NAME_TAKEN":
      return { status: 409, error: "A role with this name already exists." };
    case "ROLE_NOT_FOUND":
      return { status: 404, error: "Role not found." };
    case "ROLE_PROTECTED":
      return { status: 400, error: "System roles cannot be edited or deleted." };
    case "ROLE_HAS_MEMBERS":
      return { status: 409, error: "This role is still assigned to accounts. Move them to another role first." };
    case "ROLE_INACTIVE":
      return { status: 400, error: "Select an active role." };
    case "ACCOUNT_NOT_FOUND":
      return { status: 404, error: "User not found." };
    case "LAST_RECOVERY_ADMIN":
      return { status: 400, error: "At least one active Admin account is required." };
    default:
      return null;
  }
}

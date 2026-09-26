import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ACTIONS, type GrantScope } from "./catalog";
import { encodeGrant, normalizeGrants } from "./grants";

/**
 * Principal = "ai đang gọi" theo mô hình mới: account id, role, và GRANT hiệu lực.
 *
 * Grant KHÔNG đi trong JWT (quá lớn — xem test "lý do của D5" trong
 * compat.test.ts). JWT chỉ mang `roleIds`; mỗi request suy grant từ ĐỊNH NGHĨA
 * role, lấy qua cache 30 giây mỗi instance. Cache chứa định nghĩa role dùng
 * chung, không chứa dữ liệu người dùng. Sửa role thì tối đa 30 giây sau mọi
 * thành viên thấy quyền mới.
 *
 * Phase H: grant CHỈ đến từ định nghĩa role — role hệ thống `super_admin` mang
 * `SUPER_ADMIN_GRANTS` (code), role khác mang `role_grants`. Không còn suy từ
 * permission phẳng, tên role hay cột `portal_account.role` lúc chạy; phần đó
 * (`compat.ts`) chỉ còn cho script chuyển dữ liệu và test đối chiếu.
 */

export type RoleDefinition = {
  id: string;
  name: string;
  isActive: boolean;
  /** Định danh bất biến của role hệ thống (`super_admin`, `default_new_account`). */
  systemKey?: string | null;
  /** Permission phẳng cũ (role_permissions). */
  permissions: string[];
  /** Grant tường minh (role_grants) — null khi role chưa chuyển sang grant. */
  grants: string[] | null;
};

export type Principal = {
  accountId: string | null;
  email: string;
  roleIds: string[];
  roles: string[];
  /** Permission phẳng cũ — chỉ còn cho điều hướng/code chưa chuyển. */
  permissions: string[];
  grants: string[];
};

export const ROLE_CACHE_TTL_MS = 30_000;

export type RoleRow = {
  id: string;
  name: string;
  is_active: boolean;
  system_key?: string | null;
  grants_managed?: boolean | null;
  role_permissions: { permission_key: string }[] | null;
  role_grants?: { action: string; scope: string }[] | null;
};

const ROLE_SELECT =
  "id,name,is_active,system_key,grants_managed,role_permissions(permission_key),role_grants(action,scope)";

export function roleDefinitionFromRow(row: RoleRow): RoleDefinition {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    systemKey: row.system_key ?? null,
    permissions: (row.role_permissions ?? []).map((item) => item.permission_key),
    grants: row.grants_managed
      ? normalizeGrants(
          (row.role_grants ?? []).map((item) =>
            encodeGrant({ action: item.action, scope: item.scope as GrantScope })
          )
        )
      : null,
  };
}

/**
 * Đọc định nghĩa role. Cần rollout Phase C (`role_grants`, `system_key`); lỗi
 * thì ném — không có đường "đọc thiếu cột rồi suy tương thích" (review C P2-06).
 */
export async function fetchRoleRows(
  filter: { ids?: readonly string[] } = {}
): Promise<RoleRow[]> {
  const query = getSupabaseAdmin().from("roles").select(ROLE_SELECT);
  const { data, error } = filter.ids ? await query.in("id", [...filter.ids]) : await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RoleRow[];
}

export async function fetchRoleDefinitions(
  roleIds: readonly string[]
): Promise<Map<string, RoleDefinition>> {
  const result = new Map<string, RoleDefinition>();
  if (roleIds.length === 0) return result;
  for (const row of await fetchRoleRows({ ids: roleIds })) {
    result.set(row.id, roleDefinitionFromRow(row));
  }
  return result;
}

/**
 * Role hệ thống `super_admin`: MỌI grant trong catalog, trừ grant "thành viên"
 * (`delegatedBy` — admin không nằm trong hàng đợi CS). Định nghĩa bằng code để
 * admin khôi phục không bao giờ phụ thuộc dữ liệu grant của chính nó.
 */
export const SUPER_ADMIN_GRANTS: readonly string[] = normalizeGrants(
  ACTIONS.filter((definition) => !("delegatedBy" in definition)).flatMap((definition) =>
    definition.scopes.map((scope) => encodeGrant({ action: definition.action, scope }))
  )
);

/**
 * Grant của MỘT role (bỏ qua trạng thái hoạt động): dùng cho trần uỷ quyền và
 * Role Manager. Role chưa chuyển sang grant → không có grant nào.
 */
export function effectiveRoleGrants(role: RoleDefinition): string[] {
  if (role.systemKey === "super_admin") return [...SUPER_ADMIN_GRANTS];
  return role.grants ? [...role.grants] : [];
}

const warnedUnconverted = new Set<string>();

function warnUnconvertedRole(role: RoleDefinition): void {
  if (warnedUnconverted.has(role.id)) return;
  warnedUnconverted.add(role.id);
  console.error(
    "[authz] role chưa chuyển sang grant — thành viên không có quyền nào từ role này. " +
      "Chạy scripts/authz-migrate-role-grants.ts --apply.",
    { roleId: role.id, roleName: role.name }
  );
}

const roleCache = new Map<string, { role: RoleDefinition | null; expiresAt: number }>();

/** Định nghĩa role qua cache; role không còn tồn tại được nhớ là `null`. */
export async function loadRoleDefinitions(
  roleIds: readonly string[],
  now = Date.now(),
  fetcher: (roleIds: readonly string[]) => Promise<Map<string, RoleDefinition>> = fetchRoleDefinitions
): Promise<RoleDefinition[]> {
  const unique = [...new Set(roleIds.filter(Boolean))];
  const missing = unique.filter((id) => {
    const cached = roleCache.get(id);
    return !cached || cached.expiresAt <= now;
  });
  if (missing.length > 0) {
    const fetched = await fetcher(missing);
    for (const id of missing) {
      roleCache.set(id, { role: fetched.get(id) ?? null, expiresAt: now + ROLE_CACHE_TTL_MS });
    }
  }
  return unique
    .map((id) => roleCache.get(id)?.role ?? null)
    .filter((role): role is RoleDefinition => role !== null);
}

/** Chỉ dùng trong test. */
export function clearRoleCache(): void {
  roleCache.clear();
}

/** Grant hiệu lực = hợp grant của mọi role ĐANG hoạt động. Fail-closed. */
export function grantsForRoles(roles: readonly RoleDefinition[]): string[] {
  const all: string[] = [];
  for (const role of roles) {
    if (!role.isActive) continue;
    if (role.systemKey !== "super_admin" && role.grants === null) warnUnconvertedRole(role);
    all.push(...effectiveRoleGrants(role));
  }
  return normalizeGrants(all);
}

type SessionUserLike = {
  email?: string | null;
  accountId?: string | null;
  role?: string | null;
  roles?: string[];
  roleIds?: string[];
  permissions?: string[];
};

export async function principalFromSessionUser(user: SessionUserLike): Promise<Principal | null> {
  const email = user.email?.trim();
  if (!email) return null;
  const roleIds = user.roleIds ?? [];
  return {
    accountId: user.accountId ?? null,
    email,
    roleIds,
    roles: user.roles ?? [],
    permissions: user.permissions ?? [],
    // Phiên chưa mang `roleIds` được jwt callback làm mới ngay trong cùng lượt
    // `auth()`; tới đây vẫn thiếu thì không có grant (fail-closed).
    grants: grantsForRoles(await loadRoleDefinitions(roleIds)),
  };
}

/**
 * Grant của MỘT account khác (người nhận thông báo, người được giao lead), từ
 * kết quả `getUserAccess*`. Account không active thì không có grant nào.
 */
export async function grantsForAccess(access: {
  isActive: boolean;
  roleIds: readonly string[];
}): Promise<string[]> {
  if (!access.isActive) return [];
  return grantsForRoles(await loadRoleDefinitions(access.roleIds));
}

/**
 * Grant của phiên mà route đã giải mã (`await auth()`), không giải mã lần hai.
 * Không có phiên / email → không có grant nào.
 */
export async function grantsForSession(
  session: { user?: SessionUserLike | null } | null | undefined
): Promise<string[]> {
  if (!session?.user?.email) return [];
  return (await principalFromSessionUser(session.user))?.grants ?? [];
}

/** Principal của request hiện tại (một lần mỗi request). */
export const getPrincipal = cache(async (): Promise<Principal | null> => {
  // Import động: module này còn được lib thuần (holders, recipient-access) dùng
  // để suy grant; import tĩnh `@/auth` kéo cả next-auth vào những chỗ đó.
  const { getSession } = await import("@/lib/auth/session");
  const session = await getSession();
  if (!session?.user) return null;
  return principalFromSessionUser(session.user);
});

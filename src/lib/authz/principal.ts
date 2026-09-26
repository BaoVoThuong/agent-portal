import { cache } from "react";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { deriveCompatGrants } from "./compat";
import { encodeGrant, normalizeGrants } from "./grants";
import type { GrantScope } from "./catalog";

/**
 * Principal = "ai đang gọi" theo mô hình mới: account id, role, và GRANT hiệu lực.
 *
 * Grant KHÔNG đi trong JWT (quá lớn — xem test "lý do của D5" trong
 * compat.test.ts). JWT chỉ mang `roleIds`; mỗi request suy grant từ ĐỊNH NGHĨA
 * role, lấy qua cache 30 giây mỗi instance. Cache chứa định nghĩa role dùng
 * chung, không chứa dữ liệu người dùng. Sửa role thì tối đa 30 giây sau mọi
 * thành viên thấy quyền mới.
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
  legacyRole: string;
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
/** Trước rollout Phase C: chưa có cột/ bảng grant. */
const ROLE_SELECT_LEGACY = "id,name,is_active,role_permissions(permission_key)";

function isMissingGrantSchema(message: string | undefined): boolean {
  return /role_grants|grants_managed|system_key/.test(message ?? "");
}

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
 * Đọc định nghĩa role. Chịu được việc rollout Phase C chưa chạy (chưa có
 * `role_grants`/`system_key`): khi đó mọi role đều suy tương thích như cũ.
 */
export async function fetchRoleRows(
  filter: { ids?: readonly string[] } = {}
): Promise<RoleRow[]> {
  const run = (select: string) => {
    const query = getSupabaseAdmin().from("roles").select(select);
    return filter.ids ? query.in("id", [...filter.ids]) : query;
  };
  const first = await run(ROLE_SELECT);
  if (!first.error) return (first.data ?? []) as unknown as RoleRow[];
  if (!isMissingGrantSchema(first.error.message)) throw new Error(first.error.message);
  const fallback = await run(ROLE_SELECT_LEGACY);
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []) as unknown as RoleRow[];
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
 * Grant hiệu lực của MỘT role, dùng cho trần uỷ quyền và hiển thị trong Role
 * Manager. Role hệ thống super_admin được suy như legacy admin (đúng với các
 * account đang giữ nó).
 */
export function effectiveRoleGrants(role: RoleDefinition): string[] {
  return grantsForRoles(
    [{ ...role, isActive: true }],
    role.systemKey === "super_admin" ? "admin" : "agent"
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

/**
 * Grant hiệu lực = hợp của mọi role ĐANG hoạt động. Role đã có grant tường minh
 * dùng grant đó; role chưa chuyển thì suy tương thích từ permission + tên role.
 * Legacy admin (cột `portal_account.role`) còn mang vài quyền theo tài khoản chứ
 * không theo role (lead override, thông báo leo thang) — suy thêm một lần.
 */
export function grantsForRoles(
  roles: readonly RoleDefinition[],
  legacyRole: string | null | undefined
): string[] {
  const all: string[] = [];
  for (const role of roles) {
    if (!role.isActive) continue;
    all.push(
      ...(role.grants ??
        deriveCompatGrants({ permissions: role.permissions, roles: [role.name], legacyRole }))
    );
  }
  if (legacyRole === "admin") {
    all.push(...deriveCompatGrants({ permissions: [], roles: [], legacyRole }));
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
    legacyRole: user.role ?? "agent",
    roleIds,
    roles: user.roles ?? [],
    permissions: user.permissions ?? [],
    // Phiên tạo trước Phase B chưa mang `roleIds`: suy tương thích từ permission
    // + tên role có sẵn trong JWT (đúng dữ liệu các hàm cũ đọc) cho tới lần làm
    // mới quyền kế tiếp — jwt callback làm mới ngay những phiên này.
    grants: user.roleIds
      ? grantsForRoles(await loadRoleDefinitions(roleIds), user.role)
      : deriveCompatGrants({
          permissions: user.permissions ?? [],
          roles: user.roles ?? [],
          legacyRole: user.role,
        }),
  };
}

/**
 * Grant của MỘT account khác (người nhận thông báo, người được giao lead), từ
 * kết quả `getUserAccess*`. Account không active thì không có grant nào.
 */
export async function grantsForAccess(access: {
  isActive: boolean;
  legacyRole: string | null | undefined;
  roleIds: readonly string[];
}): Promise<string[]> {
  if (!access.isActive) return [];
  return grantsForRoles(await loadRoleDefinitions(access.roleIds), access.legacyRole);
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
  const session = await getSession();
  if (!session?.user) return null;
  return principalFromSessionUser(session.user);
});

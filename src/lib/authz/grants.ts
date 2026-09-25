import { isScopeAllowed, UNSCOPED, type Action, type GrantScope, type Scope } from "./catalog";

/**
 * Grant mã hoá thành chuỗi `action:scope` (vd `task.read:assigned`,
 * `task.export:*`). Mảng chuỗi đi trong JWT giống `permissions` cũ.
 *
 * KHÔNG dùng `can()` của rbac/client cho grant: `can()` so khớp chính xác và
 * không hiểu scope (audit C6). Dùng `hasGrant` ở đây.
 */
export type Grant = { action: string; scope: GrantScope };

export function encodeGrant(grant: Grant): string {
  return `${grant.action}:${grant.scope}`;
}

export function decodeGrant(value: string): Grant | null {
  const separator = value.lastIndexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  const action = value.slice(0, separator);
  const scope = value.slice(separator + 1);
  if (!isScopeAllowed(action, scope)) return null;
  return { action, scope };
}

/** Chuẩn hoá: bỏ grant không hợp lệ, khử trùng, sắp xếp ổn định. */
export function normalizeGrants(values: readonly string[]): string[] {
  const valid = new Set<string>();
  for (const value of values) {
    const grant = decodeGrant(value);
    if (grant) valid.add(encodeGrant(grant));
  }
  return [...valid].sort();
}

/**
 * Người này có grant `action` không.
 * - Không truyền `scope`: có ở BẤT KỲ scope nào (dùng cho cổng mở module).
 * - Truyền `scope`: có đúng scope đó. `all` KHÔNG tự bao các scope hẹp hơn ở
 *   đây — policy tự hỏi `all` trước (xem `scopeMatches`).
 */
export function hasGrant(
  grants: readonly string[] | undefined,
  action: Action,
  scope?: GrantScope
): boolean {
  if (!grants || grants.length === 0) return false;
  if (scope) return grants.includes(`${action}:${scope}`);
  const prefix = `${action}:`;
  return grants.some((grant) => grant.startsWith(prefix));
}

/** Các scope người này có cho `action`. */
export function grantedScopes(grants: readonly string[] | undefined, action: Action): GrantScope[] {
  if (!grants) return [];
  const prefix = `${action}:`;
  return grants
    .filter((grant) => grant.startsWith(prefix))
    .map((grant) => grant.slice(prefix.length) as GrantScope);
}

/** Quan hệ của người đang hỏi với MỘT bản ghi — do adapter có I/O tính trước. */
export type RelationFacts = Partial<Record<Exclude<Scope, "all">, boolean>>;

/**
 * Lõi của mọi policy: có grant `action` ở `all`, hoặc ở một scope mà quan hệ
 * tương ứng đúng với bản ghi này. Action bật/tắt (`*`) thì chỉ cần có grant.
 */
export function scopeMatches(
  grants: readonly string[] | undefined,
  action: Action,
  facts: RelationFacts = {}
): boolean {
  const scopes = grantedScopes(grants, action);
  if (scopes.length === 0) return false;
  if (scopes.includes("all") || scopes.includes(UNSCOPED)) return true;
  return scopes.some((scope) => scope !== "all" && scope !== UNSCOPED && Boolean(facts[scope]));
}

import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * `portal_account.access_version` — tăng mỗi khi quyền của account đổi (role,
 * trạng thái, email) hoặc khi định nghĩa role của họ đổi. Phiên so version của
 * mình với version hiện tại để làm mới quyền ngay, thay vì đợi TTL 5 phút
 * (audit S9, plan D11).
 *
 * Cache ở đây CHỈ chứa số version theo accountId, TTL 30 giây mỗi instance —
 * không chứa quyền, nên không có chuyện quyền người này rò sang người khác (mối
 * lo ở src/auth.ts khi quyết định không cache quyền). Hệ quả: SLA thu hồi quyền
 * ≤ 30 giây cho route đọc.
 */

export type AccessVersionLookup =
  | { status: "ok"; version: number }
  /** Không còn dòng account: làm mới ngay để phiên kết thúc. */
  | { status: "missing" }
  /** Lỗi hoặc cột chưa có (rollout chưa chạy): không kết luận gì. */
  | { status: "unknown" };

export const ACCESS_VERSION_TTL_MS = 30_000;

export async function fetchAccessVersion(accountId: string): Promise<AccessVersionLookup> {
  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select("access_version")
    .eq("id", accountId)
    .maybeSingle();
  if (error) return { status: "unknown" };
  if (!data) return { status: "missing" };
  const version = (data as { access_version?: unknown }).access_version;
  return typeof version === "number" ? { status: "ok", version } : { status: "unknown" };
}

/**
 * Một cache version — mỗi instance server có một cái (biến module). Tách thành
 * factory để test được nhiều instance độc lập (audit C13).
 */
export function createAccessVersionCache(
  fetcher: (accountId: string) => Promise<AccessVersionLookup> = fetchAccessVersion
) {
  const entries = new Map<string, { lookup: AccessVersionLookup; expiresAt: number }>();
  return {
    remember(accountId: string, lookup: AccessVersionLookup, now = Date.now()) {
      entries.set(accountId, { lookup, expiresAt: now + ACCESS_VERSION_TTL_MS });
    },
    async get(accountId: string, now = Date.now()): Promise<AccessVersionLookup> {
      const cached = entries.get(accountId);
      if (cached && cached.expiresAt > now) return cached.lookup;
      const lookup = await fetcher(accountId);
      entries.set(accountId, { lookup, expiresAt: now + ACCESS_VERSION_TTL_MS });
      return lookup;
    },
    clear() {
      entries.clear();
    },
  };
}

const defaultCache = createAccessVersionCache();

export function rememberAccessVersion(
  accountId: string,
  lookup: AccessVersionLookup,
  now = Date.now()
): void {
  defaultCache.remember(accountId, lookup, now);
}

export function getCachedAccessVersion(accountId: string, now = Date.now()): Promise<AccessVersionLookup> {
  return defaultCache.get(accountId, now);
}

/** Phiên có cần làm mới quyền ngay không. */
export function isAccessVersionStale(
  tokenVersion: number | null | undefined,
  lookup: AccessVersionLookup
): boolean {
  if (lookup.status === "missing") return true;
  if (lookup.status === "unknown") return false;
  return lookup.version !== (tokenVersion ?? 0);
}

/** Chỉ dùng trong test. */
export function clearAccessVersionCache(): void {
  defaultCache.clear();
}

/**
 * Tăng version cho các account này. Lỗi (vd rollout chưa chạy) chỉ ghi log: việc
 * quản trị đã thành công, quyền vẫn tự làm mới sau TTL 5 phút như trước.
 */
export async function bumpAccessVersion(accountIds: readonly string[]): Promise<void> {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (ids.length === 0) return;
  const { error } = await getSupabaseAdmin().rpc("bump_account_access_version", {
    p_account_ids: ids,
  });
  if (error) {
    console.error("[authz] bump_account_access_version failed", { error: error.message });
  }
}

/** Tăng version cho mọi thành viên của một role — gọi khi định nghĩa role đổi. */
export async function bumpRoleMembersAccessVersion(roleId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("bump_role_members_access_version", {
    p_role_id: roleId,
  });
  if (error) {
    console.error("[authz] bump_role_members_access_version failed", { error: error.message });
  }
}

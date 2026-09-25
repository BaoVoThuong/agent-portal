import { deriveCompatGrants } from "@/lib/authz/compat";
import { decodeGrant, normalizeGrants } from "@/lib/authz/grants";

/**
 * Grant người gọi gửi lên cho một role. Role Manager mới gửi `grants`; client cũ
 * (tab mở từ trước khi deploy) còn gửi `permissionKeys` — khi đó suy tương thích
 * để kết quả giống hệt cách role cũ được hiểu.
 *
 * Trả `null` khi request không đụng tới quyền.
 */
export function readRequestedGrants(
  payload: { grants?: unknown; permissionKeys?: unknown },
  roleName: string
): string[] | null {
  if (Array.isArray(payload.grants)) {
    return normalizeGrants(payload.grants.filter((value): value is string => typeof value === "string"));
  }
  if (Array.isArray(payload.permissionKeys)) {
    return deriveCompatGrants({
      permissions: payload.permissionKeys.filter((value): value is string => typeof value === "string"),
      roles: [roleName],
      legacyRole: "agent",
    });
  }
  return null;
}

/** Dạng jsonb cho RPC `upsert_role_atomic`. */
export function grantsForRpc(grants: readonly string[]): { action: string; scope: string }[] {
  return grants
    .map((grant) => decodeGrant(grant))
    .filter((grant): grant is NonNullable<typeof grant> => grant !== null)
    .map((grant) => ({ action: grant.action, scope: grant.scope }));
}

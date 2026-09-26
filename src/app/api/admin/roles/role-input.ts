import { decodeGrant, normalizeGrants } from "@/lib/authz/grants";

export type RequestedGrants =
  | { ok: true; grants: string[] | null }
  | { ok: false; error: string; invalid: string[] };

/**
 * Grant người gọi gửi lên cho một role — kiểm TỪNG phần tử. Có phần tử sai
 * (không phải chuỗi, action/scope không có trong catalog) thì từ chối cả
 * request thay vì lặng lẽ bỏ phần tử đó: bỏ âm thầm là lưu role thiếu quyền mà
 * người sửa không biết (review Phase C, P2-03).
 *
 * Phase H: không còn nhận `permissionKeys` của client cũ — suy grant từ
 * permission phẳng + tên role là luật tương thích đã gỡ.
 *
 * `grants: null` = request không đụng tới quyền.
 */
export function readRequestedGrants(payload: {
  grants?: unknown;
  permissionKeys?: unknown;
}): RequestedGrants {
  if (payload.grants === undefined) {
    if (payload.permissionKeys !== undefined) {
      return {
        ok: false,
        error: "This page is out of date. Reload Role Manager and save again.",
        invalid: ["permissionKeys"],
      };
    }
    return { ok: true, grants: null };
  }
  if (!Array.isArray(payload.grants)) {
    return { ok: false, error: "grants must be a list.", invalid: ["grants"] };
  }
  const invalid = payload.grants
    .filter((value) => typeof value !== "string" || decodeGrant(value) === null)
    .map((value) => String(value));
  if (invalid.length > 0) {
    return { ok: false, error: "Unknown permissions in request.", invalid };
  }
  return { ok: true, grants: normalizeGrants(payload.grants as string[]) };
}

/** Dạng jsonb cho RPC `upsert_role_atomic`. */
export function grantsForRpc(grants: readonly string[]): { action: string; scope: string }[] {
  return grants
    .map((grant) => decodeGrant(grant))
    .filter((grant): grant is NonNullable<typeof grant> => grant !== null)
    .map((grant) => ({ action: grant.action, scope: grant.scope }));
}

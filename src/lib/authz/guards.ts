import { NextResponse } from "next/server";
import type { Action, GrantScope } from "./catalog";
import { hasGrant } from "./grants";
import { getPrincipal, type Principal } from "./principal";

/**
 * Cổng gác API theo grant, với một hợp đồng thống nhất:
 *   401 — chưa đăng nhập (không có principal);
 *   403 — đã đăng nhập nhưng thiếu grant.
 * Ngoài scope của một bản ghi cụ thể thì policy của domain trả 404.
 */
export type ApiGuardResult =
  | { ok: true; principal: Principal }
  | { ok: false; response: NextResponse };

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden(error = "Forbidden"): NextResponse {
  return NextResponse.json({ error }, { status: 403 });
}

export async function requireApiPrincipal(): Promise<ApiGuardResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, response: unauthorized() };
  return { ok: true, principal };
}

export async function requireApiGrant(action: Action, scope?: GrantScope): Promise<ApiGuardResult> {
  const result = await requireApiPrincipal();
  if (!result.ok) return result;
  if (!hasGrant(result.principal.grants, action, scope)) {
    return { ok: false, response: forbidden() };
  }
  return result;
}

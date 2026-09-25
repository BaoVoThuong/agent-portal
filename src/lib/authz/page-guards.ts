import { redirect } from "next/navigation";
import { getFirstAccessiblePath } from "@/lib/rbac/routes";
import type { Action, GrantScope } from "./catalog";
import { hasGrant } from "./grants";
import { getPrincipal, type Principal } from "./principal";

/**
 * Cổng gác PAGE theo grant: chưa đăng nhập → /signin; thiếu grant → trang đầu
 * tiên người đó vào được (giống `requirePermission` cũ). Chỉ là cổng mở trang —
 * mọi API phía sau vẫn tự kiểm lại.
 */
export async function requirePageGrant(action: Action, scope?: GrantScope): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) redirect("/signin");
  if (!hasGrant(principal.grants, action, scope)) {
    redirect(getFirstAccessiblePath(principal.permissions));
  }
  return principal;
}

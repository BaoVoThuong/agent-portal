import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { getSession } from "@/lib/auth/session";
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

export type PageAccess = {
  session: Session & { user: NonNullable<Session["user"]> & { email: string } };
  principal: Principal;
};

/**
 * Cổng PAGE: có ÍT NHẤT MỘT trong các action (bất kỳ scope). Trả cả session
 * (tên hiển thị, email) lẫn principal (grant). Cả hai đi qua `cache()` của
 * React nên không giải mã phiên lần hai.
 */
export async function requirePageAnyGrant(actions: readonly Action[]): Promise<PageAccess> {
  const session = await getSession();
  const email = session?.user?.email;
  if (!session?.user || !email) redirect("/signin");
  const principal = await getPrincipal();
  if (!principal) redirect("/signin");
  if (!actions.some((action) => hasGrant(principal.grants, action))) {
    redirect(getFirstAccessiblePath(principal.permissions));
  }
  return { session: session as PageAccess["session"], principal };
}

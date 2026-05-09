import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can, canAny } from "@/lib/rbac/client";
import { getFirstAccessiblePath } from "@/lib/rbac/routes";

export async function getSessionPermissions() {
  const session = await auth();
  return session?.user?.permissions ?? [];
}

export async function hasPermission(permission: string) {
  return can(await getSessionPermissions(), permission);
}

export async function hasAnyPermission(permissions: string[]) {
  return canAny(await getSessionPermissions(), permissions);
}

export async function requirePermission(permission: string) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/signin");
  }

  if (!can(session.user.permissions, permission)) {
    redirect(getFirstAccessiblePath(session.user.permissions ?? []));
  }

  return session;
}

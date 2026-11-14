import { getSession } from "@/lib/auth/session";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { can, canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export type LicensingActor = {
  accountId: string;
  canManage: boolean;
};

type PermissionHolder = { permissions?: readonly string[] };

/** Manage bao gồm View (IMPLIED_PERMISSIONS), nên View là "có một trong hai". */
export function canViewLicensing(user: PermissionHolder): boolean {
  return canAny(user.permissions, [PERMISSIONS.HEALTH_LICENSING_VIEW, PERMISSIONS.HEALTH_LICENSING_MANAGE]);
}

export function canManageLicensing(user: PermissionHolder): boolean {
  return can(user.permissions, PERMISSIONS.HEALTH_LICENSING_MANAGE);
}

/** Người đang đăng nhập, nếu account còn hoạt động và có quyền xem. */
export async function getLicensingActor(): Promise<LicensingActor | null> {
  const session = await getSession();
  const user = session?.user;
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email || !canViewLicensing(user)) return null;

  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;

  return { accountId: (data as { id: string }).id, canManage: canManageLicensing(user) };
}

import { auth } from "@/auth";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export type TimeOffActor = {
  accountId: string;
  email: string;
  name: string;
  canManage: boolean;
};

export function canManageTimeOff(user: {
  permissions?: readonly string[];
}): boolean {
  return can(user.permissions, PERMISSIONS.TIME_OFF_ADMIN);
}

export function canUseTimeOff(user: {
  permissions?: readonly string[];
}): boolean {
  return can(user.permissions, PERMISSIONS.TIME_OFF_USER)
    || canManageTimeOff(user);
}

/** Time Off is enabled only through the dedicated Time Off permissions. */
export async function getTimeOffActor(): Promise<TimeOffActor | null> {
  const session = await auth();
  const user = session?.user;
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return null;

  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id,email,name,is_active")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  if (!canUseTimeOff(user)) return null;

  return {
    accountId: (data as { id: string }).id,
    email: (data as { email: string }).email.trim().toLowerCase(),
    name: (data as { name?: string | null }).name?.trim() || user.name?.trim() || email,
    canManage: canManageTimeOff(user),
  };
}

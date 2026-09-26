import { auth } from "@/auth";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { hasGrant } from "@/lib/authz/grants";
import { principalFromSessionUser } from "@/lib/authz/principal";
import { getSupabaseAdmin } from "@/lib/supabase";

export type TimeOffActor = {
  accountId: string;
  email: string;
  name: string;
  canManage: boolean;
};

export function canManageTimeOff(grants: readonly string[]): boolean {
  return hasGrant(grants, "timeoff.manage");
}

/** Grant tương thích cấp `timeoff.request` cho cả time_off.user lẫn time_off.admin. */
export function canUseTimeOff(grants: readonly string[]): boolean {
  return hasGrant(grants, "timeoff.request") || canManageTimeOff(grants);
}

/** Time Off is enabled only through the dedicated Time Off grants. */
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
  const grants = (await principalFromSessionUser(user))?.grants ?? [];
  if (!canUseTimeOff(grants)) return null;

  return {
    accountId: (data as { id: string }).id,
    email: (data as { email: string }).email.trim().toLowerCase(),
    name: (data as { name?: string | null }).name?.trim() || user.name?.trim() || email,
    canManage: canManageTimeOff(grants),
  };
}

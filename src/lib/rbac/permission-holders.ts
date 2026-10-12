import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Email của mọi tài khoản đang hoạt động hiện nắm một quyền, qua một role đang
 * hoạt động.
 *
 * Cố ý KHÔNG dựa vào `portal_account.role = 'admin'`: quyền hạn ở đây là theo
 * permission, và một role chuyên trách (ví dụ "Time Off Admin") có thể không
 * mang nhãn admin cũ.
 *
 */
export async function fetchActiveRoleIdsWithAnyPermission(
  permissionKeys: readonly string[]
): Promise<string[]> {
  if (permissionKeys.length === 0) return [];
  const supabase = getSupabaseAdmin();
  const { data: permissionRows, error: permissionError } = await supabase
    .from("role_permissions")
    .select("role_id")
    .in("permission_key", [...permissionKeys]);
  if (permissionError) throw new Error(permissionError.message);

  const roleIds = [...new Set((permissionRows ?? []).map((row) => row.role_id))];
  if (roleIds.length === 0) return [];

  const { data: activeRoles, error: activeRoleError } = await supabase
    .from("roles")
    .select("id")
    .in("id", roleIds)
    .eq("is_active", true);
  if (activeRoleError) throw new Error(activeRoleError.message);
  return [...new Set((activeRoles ?? []).map((row) => row.id))];
}

export async function fetchEmailsWithPermission(
  permissionKey: string
): Promise<string[]> {
  const supabase = getSupabaseAdmin();

  const activeRoleIds = await fetchActiveRoleIdsWithAnyPermission([permissionKey]);
  if (activeRoleIds.length === 0) return [];

  const { data: userRoles, error: userRoleError } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role_id", activeRoleIds);
  if (userRoleError) throw new Error(userRoleError.message);

  const userIds = [
    ...new Set((userRoles ?? []).map((row) => (row as { user_id: string }).user_id)),
  ];
  if (userIds.length === 0) return [];

  const { data: accounts, error: accountError } = await supabase
    .from("portal_account")
    .select("email")
    .in("id", userIds)
    .eq("is_active", true);
  if (accountError) throw new Error(accountError.message);

  return [
    ...new Set(
      (accounts ?? [])
        .map((row) => (row as { email: string }).email.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

import { getSupabaseAdmin } from "@/lib/supabase";
import type { Action, GrantScope } from "./catalog";
import { hasGrant } from "./grants";
import { grantsForRoles, loadRoleDefinitions } from "./principal";

/**
 * "Ai đang nắm grant X" — MỘT chỗ cho picker người được giao và danh sách người
 * nhận thông báo giám sát.
 *
 * Trước Phase D có bốn bản truy `role_permissions` trực tiếp
 * (`fetchTaskAssignees`, `fetchLeadAssignees`, `fetchTaskManagerEmails`,
 * `fetchEmailsWithPermission`) và một bản đọc cột `portal_account.role`
 * (`fetchAdminEmails`). Chúng không biết grant tường minh của role đã chuyển,
 * và mỗi bản lọc role tắt theo cách riêng.
 *
 * Ở đây grant được suy ĐÚNG như phiên đăng nhập (`grantsForRoles`): chỉ role
 * đang hoạt động, account đang hoạt động, cộng quyền theo cột legacy admin.
 */
export type GrantHolder = {
  id: string;
  email: string;
  name: string | null;
};

type AccountRow = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  user_roles: { role_id: string }[] | null;
};

export async function fetchGrantHolders(action: Action, scope?: GrantScope): Promise<GrantHolder[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("id,email,name,role,user_roles(role_id)")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  const accounts = (data ?? []) as unknown as AccountRow[];
  const roleIds = [
    ...new Set(accounts.flatMap((account) => (account.user_roles ?? []).map((row) => row.role_id))),
  ];
  const roles = await loadRoleDefinitions(roleIds);
  const roleById = new Map(roles.map((role) => [role.id, role]));

  const holders: GrantHolder[] = [];
  for (const account of accounts) {
    const email = account.email?.trim().toLowerCase();
    if (!email) continue;
    const accountRoles = (account.user_roles ?? [])
      .map((row) => roleById.get(row.role_id))
      .filter((role) => role !== undefined);
    if (hasGrant(grantsForRoles(accountRoles, account.role), action, scope)) {
      holders.push({ id: account.id, email, name: account.name });
    }
  }
  return holders;
}

export async function fetchGrantHolderEmails(action: Action, scope?: GrantScope): Promise<string[]> {
  return [...new Set((await fetchGrantHolders(action, scope)).map((holder) => holder.email))];
}

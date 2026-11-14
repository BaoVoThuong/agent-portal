import { checkAccountChange } from "@/lib/rbac/delegation";
import { fetchUserPermissionKeys } from "@/lib/rbac/role-management";
import type { getSupabaseAdmin } from "@/lib/supabase";

type LinkedAccount = { id: string; email: string; is_active: boolean };

/**
 * Gắn Slack email vào account nào thì bot chạy thử (và về sau ghi) dưới tên
 * account đó, nên dùng đúng trần uỷ quyền của Account Manager: không gắn được
 * account có quyền mà người sửa không có.
 */
export function checkSlackBotLink(input: {
  actorEmail: string;
  actorPermissions: readonly string[];
  account: LinkedAccount | null;
  accountPermissionKeys: readonly string[];
}): { ok: true } | { ok: false; status: 400 | 403; error: string } {
  if (!input.account) return { ok: true };
  if (!input.account.is_active) return { ok: false, status: 400, error: "Link an active account." };
  return checkAccountChange({
    actorPermissions: input.actorPermissions,
    isSelf: input.account.email.trim().toLowerCase() === input.actorEmail.trim().toLowerCase(),
    targetPermissionKeys: input.accountPermissionKeys,
  });
}

/** `null` = không gắn account; `"missing"` = id không tồn tại. */
export async function loadLink(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  accountId: string | null,
): Promise<null | "missing" | { account: LinkedAccount; permissionKeys: string[] }> {
  if (!accountId) return null;
  const { data, error } = await supabase
    .from("portal_account")
    .select("id,email,is_active")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return "missing";
  return { account: data as LinkedAccount, permissionKeys: await fetchUserPermissionKeys(accountId) };
}

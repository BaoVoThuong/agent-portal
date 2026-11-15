import { invalidateRbacLookups } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "./client";
import { isAssignablePermissionKey, normalizeExclusivePermissionKeys, PERMISSIONS } from "./permissions";
import { fetchRolePermissionKeys } from "./role-management";
import { checkRolePermissionChange } from "./delegation";
import { botFail, botOk, findRoleByName, touchesProtected, type BotActionResult } from "./bot-changes";

/**
 * Slack bot: tick / bỏ tick một quyền trên một role, như chính người duyệt làm trong
 * Role Manager — cùng quyền đòi hỏi, cùng kiểm uỷ quyền (checkRolePermissionChange),
 * cùng hàm ghi update_role_atomic.
 */
export async function botSetRolePermission(
  action: { role_name: string; permission_key: string; enabled: boolean },
  actorPermissions: readonly string[],
): Promise<BotActionResult> {
  if (!can(actorPermissions, PERMISSIONS.ROLE_MANAGER)) return botFail(403, "The approver does not have Role Manager.");
  if (!isAssignablePermissionKey(action.permission_key)) return botFail(400, "Unknown permission.");
  const role = await findRoleByName(action.role_name);
  if (!role) return botFail(404, `Role "${action.role_name}" not found.`);
  const live = await fetchRolePermissionKeys(role.id);
  // Admin giữ mọi quyền, kể cả Role Manager, nên cũng bị chặn ở đây.
  if (touchesProtected(live) || touchesProtected([action.permission_key])) {
    return botFail(403, "The bot does not change roles that hold Role Manager or Slack Bot - Manage. Do it in Role Manager.");
  }
  const wanted = action.enabled ? [...live, action.permission_key] : live.filter((key) => key !== action.permission_key);
  const next = normalizeExclusivePermissionKeys(wanted).filter(isAssignablePermissionKey);
  const same = next.length === live.length && next.every((key) => live.includes(key));
  if (same) return botOk(`Role ${role.name} already ${action.enabled ? "has" : "lacks"} that permission; nothing changed.`);
  const delegation = checkRolePermissionChange({ actorPermissions: [...actorPermissions], currentKeys: live, nextKeys: next });
  if (!delegation.ok) return botFail(delegation.status, delegation.error);
  const { error } = await getSupabaseAdmin().rpc("update_role_atomic", { p_role_id: role.id, p_patch: {}, p_permission_keys: next });
  if (error) return botFail(500, error.message);
  invalidateRbacLookups();
  return botOk(`${action.enabled ? "Ticked" : "Unticked"} ${action.permission_key} on role ${role.name}.`);
}

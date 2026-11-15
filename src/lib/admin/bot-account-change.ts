import { invalidateRbacLookups } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fetchActiveRolesByIds,
  fetchRolePermissionKeys,
  fetchUserPermissionKeys,
  fetchUserRoleId,
} from "@/lib/rbac/role-management";
import { checkAccountChange, checkMembershipChange } from "@/lib/rbac/delegation";
import { botFail, botOk, escapeLike, findRoleByName, touchesProtected, type BotActionResult } from "@/lib/rbac/bot-changes";
import { invalidateTaskMembershipLookups } from "@/lib/tasks/membership";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";
import { accountWriteFailure } from "./account-write-errors";

/**
 * Slack bot: đổi role, Position, Assistant, khoá/mở một account, như chính người duyệt
 * làm trong Account Manager — cùng quyền đòi hỏi, cùng kiểm uỷ quyền
 * (checkAccountChange, checkMembershipChange), cùng hàm ghi update_account_atomic
 * (kèm `expected` để không ghi đè thay đổi của người khác).
 */

export type BotAccountAction =
  | { kind: "account_role"; account_email: string; role_name: string }
  | { kind: "account_position"; account_email: string; position_name: string; assisted_agent_emails?: string[] }
  | { kind: "assistant_link"; account_email: string; agent_email: string; linked: boolean }
  | { kind: "account_active"; account_email: string; active: boolean };

const normEmail = (value: string) => value.trim().toLowerCase();

type Target = { id: string; email: string; name: string | null; is_active: boolean; position_id: string | null; manager_id: string | null };

async function findAccount(email: string): Promise<Target | null> {
  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id,email,name,is_active,position_id,manager_id")
    .ilike("email", escapeLike(email))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Target | null) ?? null;
}

async function findPositionByName(name: string): Promise<{ id: string; name: string; kind: string } | null> {
  const { data, error } = await getSupabaseAdmin().from("positions").select("id,name,kind").ilike("name", escapeLike(name));
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; name: string; kind: string }[];
  return rows.length === 1 ? rows[0] : null;
}

async function positionKind(positionId: string | null): Promise<string | null> {
  if (!positionId) return null;
  const { data, error } = await getSupabaseAdmin().from("positions").select("kind").eq("id", positionId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { kind: string } | null)?.kind ?? null;
}

async function assistedAgents(email: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("agent_email")
    .ilike("cs_email", escapeLike(email))
    .eq("is_assistant", true);
  if (error) throw new Error(error.message);
  return [...new Set(((data ?? []) as { agent_email: string }[]).map((row) => normEmail(row.agent_email)))].sort();
}

const label = (t: Target) => t.name?.trim() || t.email;

async function writeAccount(target: Target, patch: Record<string, unknown>, roleId: string | null, membership: boolean) {
  const { error } = await getSupabaseAdmin().rpc("update_account_atomic", {
    p_user_id: target.id,
    p_patch: patch,
    p_role_id: roleId,
  });
  if (error) {
    const failure = accountWriteFailure(error);
    return botFail(failure.status, failure.error);
  }
  invalidateRbacLookups();
  if (membership) {
    invalidateTaskMembershipLookups();
    await broadcastTableConfigChanged();
  }
  return null;
}

export async function botChangeAccount(
  action: BotAccountAction,
  actorPermissions: readonly string[],
  approverEmail: string,
): Promise<BotActionResult> {
  const actor = [...actorPermissions];
  if (!can(actor, PERMISSIONS.ACCOUNT_MANAGER)) return botFail(403, "The approver does not have Account Manager.");
  const target = await findAccount(action.account_email);
  if (!target) return botFail(404, `No portal account ${action.account_email}.`);
  const targetPermissionKeys = await fetchUserPermissionKeys(target.id);
  if (touchesProtected(targetPermissionKeys)) {
    return botFail(403, "The bot does not change accounts that hold Role Manager or Slack Bot - Manage. Do it in Account Manager.");
  }
  const isSelf = normEmail(target.email) === normEmail(approverEmail);

  if (action.kind === "account_role") {
    const role = await findRoleByName(action.role_name);
    if (!role) return botFail(404, `Role "${action.role_name}" not found.`);
    const [active] = await fetchActiveRolesByIds([role.id]);
    if (!active) return botFail(400, `Role ${role.name} is turned off.`);
    const nextKeys = await fetchRolePermissionKeys(role.id);
    if (touchesProtected(nextKeys)) return botFail(403, "The bot does not move people into roles that hold Role Manager or Slack Bot - Manage.");
    if ((await fetchUserRoleId(target.id)) === role.id) return botOk(`${label(target)} is already on role ${role.name}; nothing changed.`);
    const delegation = checkAccountChange({ actorPermissions: actor, isSelf, targetPermissionKeys, nextRolePermissionKeys: nextKeys });
    if (!delegation.ok) return botFail(delegation.status, delegation.error);
    const failed = await writeAccount(target, {}, role.id, false);
    return failed ?? botOk(`${label(target)} is now on role ${role.name}.`);
  }

  if (action.kind === "account_active") {
    if (isSelf && !action.active) return botFail(400, "You cannot deactivate your own account.");
    if (target.is_active === action.active) return botOk(`${label(target)} is already ${action.active ? "active" : "disabled"}; nothing changed.`);
    const delegation = checkAccountChange({ actorPermissions: actor, isSelf, targetPermissionKeys });
    if (!delegation.ok) return botFail(delegation.status, delegation.error);
    const failed = await writeAccount(target, { is_active: action.active }, null, false);
    return failed ?? botOk(`${label(target)} is now ${action.active ? "active" : "disabled"}.`);
  }

  // Position và Assistant: luật của Account Manager (không tự sửa mình, chỉ account trong quyền mình).
  const membership = checkMembershipChange({ actorPermissions: actor, isSelf, targetPermissionKeys });
  if (!membership.ok) return botFail(membership.status, membership.error);
  const currentAssists = await assistedAgents(target.email);
  const expected = { position_id: target.position_id, manager_id: target.manager_id, assisted_agent_emails: currentAssists };

  if (action.kind === "account_position") {
    const position = await findPositionByName(action.position_name);
    if (!position) return botFail(404, `Position "${action.position_name}" not found.`);
    if (!target.is_active && (position.kind === "agent" || position.kind === "assistant")) {
      return botFail(400, "Enable the account before making it an Agent or Assistant.");
    }
    if (position.id === target.position_id && !action.assisted_agent_emails) {
      return botOk(`${label(target)} already has position ${position.name}; nothing changed.`);
    }
    const patch: Record<string, unknown> = { position_id: position.id, expected };
    if (position.kind === "assistant") patch.assisted_agent_emails = action.assisted_agent_emails ?? currentAssists;
    const failed = await writeAccount(target, patch, null, true);
    return failed ?? botOk(`${label(target)} now has position ${position.name}.`);
  }

  // assistant_link
  if ((await positionKind(target.position_id)) !== "assistant") {
    return botFail(400, `${label(target)} does not have the Assistant position. Change the position to Assistant first.`);
  }
  const next = action.linked
    ? [...new Set([...currentAssists, action.agent_email])].sort()
    : currentAssists.filter((email) => email !== action.agent_email);
  if (next.length === currentAssists.length && next.every((email, i) => email === currentAssists[i])) {
    return botOk(`${label(target)} ${action.linked ? "already assists" : "does not assist"} ${action.agent_email}; nothing changed.`);
  }
  const failed = await writeAccount(target, { assisted_agent_emails: next, expected }, null, true);
  return failed ?? botOk(`${label(target)} ${action.linked ? "now assists" : "no longer assists"} ${action.agent_email}.`);
}

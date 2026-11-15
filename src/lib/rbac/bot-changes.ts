import { getSupabaseAdmin } from "@/lib/supabase";
import { PERMISSIONS } from "./permissions";

/**
 * Phần dùng chung cho các thay đổi Slack bot làm sau khi được duyệt (2026-11-15).
 * Thao tác role nằm ở lib/rbac/bot-role-change.ts (Role Manager), thao tác account ở
 * lib/admin/bot-account-change.ts (Account Manager): mỗi module tự kiểm quyền của
 * mình, lib/slack-bot chỉ điều phối (luật module-boundaries).
 *
 * Luật riêng của bot (spec §4 mục 8): không đụng role nào có Role Manager hoặc Slack
 * Bot - Manage, không đưa ai vào role đó, không đụng account đang giữ hai quyền đó.
 * Admin giữ mọi quyền nên cũng nằm trong luật này; không cần so tên role.
 */
export const BOT_PROTECTED_PERMISSIONS: readonly string[] = [PERMISSIONS.ROLE_MANAGER, PERMISSIONS.SLACK_BOT_MANAGE];

export function touchesProtected(keys: readonly string[]): boolean {
  return keys.some((key) => BOT_PROTECTED_PERMISSIONS.includes(key));
}

export type BotActionResult = { status: number; body: { ok: true; summary: string } | { error: string } };

export const botOk = (summary: string): BotActionResult => ({ status: 200, body: { ok: true, summary } });
export const botFail = (status: number, error: string): BotActionResult => ({ status, body: { error } });

/** ilike so khớp không phân biệt hoa thường; thoát % và _ để "_" trong email không thành ký tự đại diện. */
export const escapeLike = (value: string) => value.trim().replace(/[\\%_]/g, "\\$&");

export async function findRoleByName(name: string): Promise<{ id: string; name: string; is_active: boolean } | null> {
  const { data, error } = await getSupabaseAdmin().from("roles").select("id,name,is_active").ilike("name", escapeLike(name));
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; name: string; is_active: boolean }[];
  return rows.length === 1 ? rows[0] : null;
}

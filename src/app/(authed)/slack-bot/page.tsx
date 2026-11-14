import { requirePermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { SLACK_BOT_USER_COLUMNS, type SlackBotUserRow } from "@/lib/slack-bot/users";
import { SlackBotUsersClient } from "./SlackBotUsersClient";

export const dynamic = "force-dynamic";

export default async function SlackBotPage() {
  await requirePermission(PERMISSIONS.SLACK_BOT_MANAGE);
  const supabase = getSupabaseAdmin();
  const [usersRes, accountsRes] = await Promise.all([
    supabase.from("slack_bot_users").select(SLACK_BOT_USER_COLUMNS).order("slack_email", { ascending: true }),
    supabase.from("portal_account").select("id,email,name,is_active").order("name", { ascending: true }),
  ]);
  if (usersRes.error) throw new Error(usersRes.error.message);
  if (accountsRes.error) throw new Error(accountsRes.error.message);
  return (
    <SlackBotUsersClient
      initialUsers={(usersRes.data ?? []) as SlackBotUserRow[]}
      accounts={(accountsRes.data ?? []) as Array<{ id: string; email: string; name: string | null; is_active: boolean }>}
    />
  );
}

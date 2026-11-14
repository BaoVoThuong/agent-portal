import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  SLACK_BOT_USER_COLUMNS,
  parseSlackBotUserInput,
  slackBotWriteFailure,
} from "@/lib/slack-bot/users";
import { checkSlackBotLink, loadLink } from "@/lib/slack-bot/link-guard";

export const dynamic = "force-dynamic";

async function requireManager() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!can(session.user.permissions, PERMISSIONS.SLACK_BOT_MANAGE)) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, email, permissions: session.user.permissions ?? [] };
}

export async function GET() {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  const { data, error } = await getSupabaseAdmin()
    .from("slack_bot_users")
    .select(SLACK_BOT_USER_COLUMNS)
    .order("slack_email", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(req: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const parsed = parseSlackBotUserInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const link = await loadLink(supabase, parsed.value.portal_account_id);
  if (link === "missing") return NextResponse.json({ error: "Invalid portal account." }, { status: 400 });
  const allowed = checkSlackBotLink({
    actorEmail: guard.email,
    actorPermissions: guard.permissions,
    account: link?.account ?? null,
    accountPermissionKeys: link?.permissionKeys ?? [],
  });
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const { data, error } = await supabase
    .from("slack_bot_users")
    .insert({ ...parsed.value, created_by_email: guard.email, updated_by_email: guard.email })
    .select(SLACK_BOT_USER_COLUMNS)
    .single();
  if (error) {
    const failure = slackBotWriteFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
  return NextResponse.json({ user: data }, { status: 201 });
}

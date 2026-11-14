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

type RouteContext = { params: Promise<{ id: string }> };

async function requireManager() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!can(session.user.permissions, PERMISSIONS.SLACK_BOT_MANAGE)) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, email, permissions: session.user.permissions ?? [] };
}

export async function PATCH(req: Request, context: RouteContext) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;

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
    .update({ ...parsed.value, updated_by_email: guard.email, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(SLACK_BOT_USER_COLUMNS)
    .maybeSingle();
  if (error) {
    const failure = slackBotWriteFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ user: data });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const { data, error } = await getSupabaseAdmin()
    .from("slack_bot_users")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

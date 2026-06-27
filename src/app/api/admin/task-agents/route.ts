import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const AGENT_GROUP_PERMISSIONS = [PERMISSIONS.ACCOUNT_MANAGER, PERMISSIONS.TASK_MANAGE];

function canManageAgentGroups(permissions: readonly string[] | undefined): boolean {
  return canAny(permissions, AGENT_GROUP_PERMISSIONS);
}

export async function GET() {
  const session = await auth();
  if (!canManageAgentGroups(session?.user?.permissions)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  const { data: selected, error: selectedErr } = await sb
    .from("task_agents")
    .select("email");
  if (selectedErr) return NextResponse.json({ error: selectedErr.message }, { status: 500 });

  const emails = [...new Set((selected ?? []).map((row) => (row as { email: string }).email))];
  if (emails.length === 0) return NextResponse.json({ agents: [] });

  const { data, error } = await sb
    .from("portal_account")
    .select("email,name,is_active")
    .in("email", emails)
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ agents: sortPeople(data ?? []) });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!canManageAgentGroups(session?.user?.permissions)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: account, error: accountErr } = await sb
    .from("portal_account")
    .select("email,name,is_active")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (accountErr) return NextResponse.json({ error: accountErr.message }, { status: 500 });
  if (!account) return NextResponse.json({ error: "Person not found." }, { status: 404 });

  const { error } = await sb
    .from("task_agents")
    .upsert({ email }, { onConflict: "email", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = account as { email: string; name: string | null };
  return NextResponse.json({ agent: { email: row.email, name: row.name } });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!canManageAgentGroups(session?.user?.permissions)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { error: memberErr } = await sb
    .from("agent_members")
    .delete()
    .eq("agent_email", email);
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });

  const { error } = await sb.from("task_agents").delete().eq("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

function sortPeople(
  rows: { email?: string | null; name?: string | null }[]
): { email: string; name: string | null }[] {
  return rows
    .filter((row): row is { email: string; name: string | null } =>
      typeof row.email === "string"
    )
    .map((row) => ({ email: row.email, name: row.name ?? null }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

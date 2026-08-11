import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await loadConfigAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const sb = getSupabaseAdmin();
  const { data: selected, error: selectedErr } = await sb.from("task_agents").select("email");
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

export async function POST(request: Request) {
  const admin = await loadConfigAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
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

  await broadcastTableConfigChanged();
  const row = account as { email: string; name: string | null };
  return NextResponse.json({ agent: { email: row.email, name: row.name } });
}

export async function DELETE(request: Request) {
  const admin = await loadConfigAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const { error } = await getSupabaseAdmin().rpc("delete_task_agent_atomic", {
    p_email: email,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastTableConfigChanged();
  return NextResponse.json({ ok: true });
}

function sortPeople(rows: { email?: string | null; name?: string | null }[]) {
  return rows
    .filter((row): row is { email: string; name: string | null } => typeof row.email === "string")
    .map((row) => ({ email: row.email, name: row.name ?? null }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

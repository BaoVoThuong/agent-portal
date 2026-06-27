import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!can(session?.user?.permissions, PERMISSIONS.ACCOUNT_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = new URL(req.url).searchParams.get("agent");
  if (!agent) return NextResponse.json({ members: [] });

  const { data } = await getSupabaseAdmin()
    .from("agent_members")
    .select("cs_email")
    .eq("agent_email", agent);

  return NextResponse.json({
    members: (data ?? []).map((r) => (r as { cs_email: string }).cs_email),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!can(session?.user?.permissions, PERMISSIONS.ACCOUNT_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const agent_email =
    typeof body?.agent_email === "string" ? body.agent_email : "";
  const cs_email = typeof body?.cs_email === "string" ? body.cs_email : "";

  if (!agent_email || !cs_email) {
    return NextResponse.json(
      { error: "agent_email and cs_email required" },
      { status: 400 }
    );
  }

  const { error } = await getSupabaseAdmin()
    .from("agent_members")
    .upsert({ agent_email, cs_email }, { onConflict: "agent_email,cs_email", ignoreDuplicates: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!can(session?.user?.permissions, PERMISSIONS.ACCOUNT_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const agent_email =
    typeof body?.agent_email === "string" ? body.agent_email : "";
  const cs_email = typeof body?.cs_email === "string" ? body.cs_email : "";

  const { error } = await getSupabaseAdmin()
    .from("agent_members")
    .delete()
    .eq("agent_email", agent_email)
    .eq("cs_email", cs_email);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

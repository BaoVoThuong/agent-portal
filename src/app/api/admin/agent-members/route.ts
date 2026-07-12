import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isTaskViewAdmin } from "@/lib/tasks/access";

export const dynamic = "force-dynamic";

async function requireTaskAdmin() {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) return { error: "Unauthorized" as const, status: 401 };
  if (!isTaskViewAdmin(session.user)) {
    return { error: "Unauthorized" as const, status: 403 };
  }
  return { ok: true as const };
}

export async function GET(req: Request) {
  const admin = await requireTaskAdmin();
  if ("error" in admin) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const agent = new URL(req.url).searchParams.get("agent");
  if (!agent) return NextResponse.json({ members: [] });

  const { data } = await getSupabaseAdmin()
    .from("agent_members")
    .select("cs_email,is_assistant")
    .eq("agent_email", agent);

  return NextResponse.json({
    members: (data ?? []).map((r) => {
      const row = r as { cs_email: string; is_assistant: boolean };
      return { email: row.cs_email, is_assistant: row.is_assistant };
    }),
  });
}

export async function POST(req: Request) {
  const admin = await requireTaskAdmin();
  if ("error" in admin) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const body = await req.json().catch(() => null);
  const agent_email =
    typeof body?.agent_email === "string" ? body.agent_email : "";
  const cs_email = typeof body?.cs_email === "string" ? body.cs_email : "";
  const is_assistant = body?.is_assistant === true;

  if (!agent_email || !cs_email) {
    return NextResponse.json(
      { error: "agent_email and cs_email required" },
      { status: 400 }
    );
  }

  const sb = getSupabaseAdmin();
  const { data: agentRow, error: agentErr } = await sb
    .from("task_agents")
    .select("email")
    .eq("email", agent_email)
    .maybeSingle();
  if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
  if (!agentRow) {
    return NextResponse.json(
      { error: "Select this person as an agent first." },
      { status: 400 }
    );
  }

  const { error } = await sb
    .from("agent_members")
    .upsert(
      { agent_email, cs_email, is_assistant },
      { onConflict: "agent_email,cs_email" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const admin = await requireTaskAdmin();
  if ("error" in admin) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
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

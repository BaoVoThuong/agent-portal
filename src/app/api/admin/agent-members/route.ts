import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { isAgentOwnerOrAssistant } from "@/lib/tasks/membership";

export const dynamic = "force-dynamic";

const AGENT_GROUP_PERMISSIONS = [PERMISSIONS.ACCOUNT_MANAGER, PERMISSIONS.TASK_MANAGE];

function hasGlobalAgentGroupAccess(permissions: readonly string[] | undefined): boolean {
  return canAny(permissions, AGENT_GROUP_PERMISSIONS);
}

// Global admin, OR the agent themself / one of their promoted Assistants —
// scoped to managing only THAT agent's own group, not anyone else's.
async function canManageThisAgentGroup(
  permissions: readonly string[] | undefined,
  actorEmail: string,
  agentEmail: string
): Promise<boolean> {
  if (hasGlobalAgentGroupAccess(permissions)) return true;
  return isAgentOwnerOrAssistant(agentEmail, actorEmail);
}

export async function GET(req: Request) {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agent = new URL(req.url).searchParams.get("agent");
  if (!agent) return NextResponse.json({ members: [] });

  if (!(await canManageThisAgentGroup(session.user.permissions, actorEmail, agent))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  if (!(await canManageThisAgentGroup(session.user.permissions, actorEmail, agent_email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const agent_email =
    typeof body?.agent_email === "string" ? body.agent_email : "";
  const cs_email = typeof body?.cs_email === "string" ? body.cs_email : "";

  if (!(await canManageThisAgentGroup(session.user.permissions, actorEmail, agent_email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await getSupabaseAdmin()
    .from("agent_members")
    .delete()
    .eq("agent_email", agent_email)
    .eq("cs_email", cs_email);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTaskAgentCandidates, fetchTaskAgents } from "@/lib/tasks/assignees";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";
import { mapAssistantMembershipError } from "@/lib/tasks/membership-mutation";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const supabase = getSupabaseAdmin();
  const [agents, candidates, memberships] = await Promise.all([
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    supabase
      .from("agent_members")
      .select("agent_email,cs_email,is_assistant")
      .eq("is_assistant", true),
  ]);

  if (memberships.error) {
    return NextResponse.json({ error: memberships.error.message }, { status: 500 });
  }

  return NextResponse.json({
    agents,
    candidates,
    members: (memberships.data ?? []).map((row) => {
      const membership = row as {
        agent_email: string;
        cs_email: string;
        is_assistant: boolean;
      };
      return {
        agent_email: membership.agent_email,
        cs_email: membership.cs_email,
        is_assistant: membership.is_assistant,
      };
    }),
  });
}

export async function POST(request: Request) {
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const body = await request.json().catch(() => null);
  const agent_email =
    typeof body?.agent_email === "string" ? body.agent_email.trim().toLowerCase() : "";
  const cs_email =
    typeof body?.cs_email === "string" ? body.cs_email.trim().toLowerCase() : "";
  if (!agent_email || !cs_email) {
    return NextResponse.json(
      { error: "agent_email and cs_email are required." },
      { status: 400 }
    );
  }

  const { error } = await getSupabaseAdmin().rpc("create_agent_membership_atomic", {
    p_agent_email: agent_email,
    p_cs_email: cs_email,
  });
  if (error) {
    const mapped = mapAssistantMembershipError(error);
    return NextResponse.json(
      { code: mapped.code, error: mapped.error },
      { status: mapped.status }
    );
  }

  await broadcastTableConfigChanged();
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const body = await request.json().catch(() => null);
  const agent_email =
    typeof body?.agent_email === "string" ? body.agent_email.trim().toLowerCase() : "";
  const cs_email =
    typeof body?.cs_email === "string" ? body.cs_email.trim().toLowerCase() : "";
  if (!agent_email || !cs_email) {
    return NextResponse.json(
      { error: "agent_email and cs_email are required." },
      { status: 400 }
    );
  }

  const { error } = await getSupabaseAdmin()
    .from("agent_members")
    .delete()
    .eq("agent_email", agent_email)
    .eq("cs_email", cs_email)
    .eq("is_assistant", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastTableConfigChanged();
  return NextResponse.json({ ok: true });
}

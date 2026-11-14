import { NextResponse } from "next/server";
import { getLicensingActor } from "@/lib/health-licensing/access";
import { licensingDatabaseMessage } from "@/lib/health-licensing/errors";
import { fetchAppointmentAgentIds, fetchLicensingAgents } from "@/lib/health-licensing/queries";
import { isUuid, parseAppointmentDetails } from "@/lib/health-licensing/validate";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function manager() {
  const actor = await getLicensingActor();
  if (!actor) return { actor: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!actor.canManage) {
    return {
      actor: null,
      error: NextResponse.json(
        { error: "State Licensing - Manage is required to change appointments." },
        { status: 403 },
      ),
    };
  }
  return { actor, error: null };
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { actor, error: denied } = await manager();
  if (!actor) return denied;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const [agents, currentAgentIds] = await Promise.all([fetchLicensingAgents(), fetchAppointmentAgentIds(id)]);
  // Bang và hãng không đổi ở đây: đổi hãng là bỏ chọn ở ô sản phẩm rồi chọn hãng khác.
  const parsed = parseAppointmentDetails(body, {
    // Agent đã có trên appointment vẫn giữ được dù nay không còn là Agent.
    agentIds: new Set([...agents.map((a) => a.accountId), ...currentAgentIds]),
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const v = parsed.value;
  const { error } = await getSupabaseAdmin().rpc("licensing_save_appointment", {
    p_id: id,
    p_state_code: null,
    p_option_id: null,
    p_status: v.status,
    p_appointed_on: v.appointedOn,
    p_note: v.note,
    p_agents: v.agents.map((a) => ({ account_id: a.accountId, appointed_on: a.appointedOn })),
    p_actor: actor.accountId,
  });
  if (error) {
    const mapped = licensingDatabaseMessage(error.message);
    if (mapped.status === 500) console.error("[health-licensing] update failed", error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
  return NextResponse.json({ id });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { actor, error: denied } = await manager();
  if (!actor) return denied;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });

  const { error } = await getSupabaseAdmin().rpc("licensing_delete_appointment", {
    p_id: id,
    p_actor: actor.accountId,
  });
  if (error) {
    const mapped = licensingDatabaseMessage(error.message);
    if (mapped.status === 500) console.error("[health-licensing] delete failed", error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
  return NextResponse.json({ ok: true });
}

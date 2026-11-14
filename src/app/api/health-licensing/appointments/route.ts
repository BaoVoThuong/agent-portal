import { NextResponse } from "next/server";
import { getLicensingActor } from "@/lib/health-licensing/access";
import { licensingDatabaseMessage } from "@/lib/health-licensing/errors";
import { fetchLicensingAgents, fetchLicensingCatalog } from "@/lib/health-licensing/queries";
import { parseNewAppointment } from "@/lib/health-licensing/validate";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Thêm một hãng vào một bang kèm chi tiết (dialog New appointment). */
export async function POST(request: Request) {
  const actor = await getLicensingActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!actor.canManage) {
    return NextResponse.json({ error: "State Licensing - Manage is required to add appointments." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const [catalog, agents] = await Promise.all([fetchLicensingCatalog(), fetchLicensingAgents()]);
  const parsed = parseNewAppointment(body, {
    optionIds: catalog.optionIds,
    agentIds: new Set(agents.map((a) => a.accountId)),
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const v = parsed.value;
  const { data, error } = await getSupabaseAdmin().rpc("licensing_save_appointment", {
    p_id: null,
    p_state_code: v.stateCode,
    p_option_id: v.optionId,
    p_status: v.status,
    p_appointed_on: v.appointedOn,
    p_note: v.note,
    p_agents: v.agents.map((a) => ({ account_id: a.accountId, appointed_on: a.appointedOn })),
    p_actor: actor.accountId,
  });
  if (error) {
    const mapped = licensingDatabaseMessage(error.message);
    if (mapped.status === 500) console.error("[health-licensing] create failed", error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
  return NextResponse.json({ id: data });
}

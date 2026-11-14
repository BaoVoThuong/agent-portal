import { NextResponse } from "next/server";
import { getLicensingActor } from "@/lib/health-licensing/access";
import { licensingDatabaseMessage } from "@/lib/health-licensing/errors";
import { fetchLicensingCatalog } from "@/lib/health-licensing/queries";
import { parseStateSelection } from "@/lib/health-licensing/validate";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isUsStateCode } from "@/lib/us-states";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Lưu các ô chọn nhiều của một bang (dialog chi tiết bang → Save changes).
 * Hãng mới chọn thành appointment Active; hãng bỏ chọn bị xoá mềm.
 */
export async function PUT(request: Request, { params }: Ctx) {
  const actor = await getLicensingActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!actor.canManage) {
    return NextResponse.json({ error: "State Licensing - Manage is required to change carriers." }, { status: 403 });
  }
  const { code } = await params;
  const stateCode = code.toUpperCase();
  if (!isUsStateCode(stateCode)) return NextResponse.json({ error: "Unknown state." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const catalog = await fetchLicensingCatalog();
  const parsed = parseStateSelection(body, catalog.optionsByColumn);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await getSupabaseAdmin().rpc("licensing_save_state", {
    p_state_code: stateCode,
    p_selection: parsed.value,
    p_actor: actor.accountId,
  });
  if (error) {
    const mapped = licensingDatabaseMessage(error.message);
    if (mapped.status === 500) console.error("[health-licensing] save state failed", error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
  return NextResponse.json(data ?? { added: 0, removed: 0 });
}

import { NextResponse } from "next/server";
import { getLicensingActor } from "@/lib/health-licensing/access";
import { fetchLicensingAgents, loadLicensingBoard } from "@/lib/health-licensing/queries";

export const dynamic = "force-dynamic";

/** Toàn bộ bảng licensing (và danh sách agent cho người có quyền Manage). */
export async function GET() {
  const actor = await getLicensingActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [board, agents] = await Promise.all([
      loadLicensingBoard(),
      actor.canManage ? fetchLicensingAgents() : Promise.resolve([]),
    ]);
    return NextResponse.json({ board, agents });
  } catch (error) {
    console.error("[health-licensing] load failed", error);
    return NextResponse.json({ error: "Could not load the licensing map." }, { status: 500 });
  }
}

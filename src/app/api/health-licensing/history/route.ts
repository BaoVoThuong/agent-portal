import { NextResponse } from "next/server";
import { getLicensingActor } from "@/lib/health-licensing/access";
import { loadLicensingHistory } from "@/lib/health-licensing/queries";
import { isUuid } from "@/lib/health-licensing/validate";
import { isUsStateCode } from "@/lib/us-states";

export const dynamic = "force-dynamic";

/** ?state=TX lọc theo bang, ?appointment=<uuid> theo một appointment; ?before=<id> lấy trang tiếp theo. */
export async function GET(request: Request) {
  const actor = await getLicensingActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const appointment = url.searchParams.get("appointment");
  const before = Number(url.searchParams.get("before"));
  if (state && !isUsStateCode(state)) return NextResponse.json({ error: "Unknown state." }, { status: 400 });
  if (appointment && !isUuid(appointment)) {
    return NextResponse.json({ error: "Unknown appointment." }, { status: 400 });
  }
  try {
    const page = await loadLicensingHistory({
      stateCode: state,
      appointmentId: appointment,
      beforeId: Number.isInteger(before) && before > 0 ? before : null,
    });
    return NextResponse.json(page);
  } catch (error) {
    console.error("[health-licensing] history failed", error);
    return NextResponse.json({ error: "Could not load the history." }, { status: 500 });
  }
}

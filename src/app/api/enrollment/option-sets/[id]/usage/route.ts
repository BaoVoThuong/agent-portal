import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  canManageEnrollmentOptions,
  loadEnrollmentActor,
} from "@/lib/enrollment/access";
import { inactiveConfigValueResponse } from "@/lib/table-config/mutation-errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  }
  if (!canManageEnrollmentOptions(actorResult.actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await getSupabaseAdmin().rpc("enrollment_option_usage_count", {
    p_option_id: id,
  });
  if (error) {
    if (error.message?.includes("CONFIG_OPTION_NOT_FOUND")) {
      return NextResponse.json(inactiveConfigValueResponse("Option"), { status: 409 });
    }
    return NextResponse.json({ error: "Could not check option usage." }, { status: 500 });
  }
  const usageCount = typeof data === "number" ? data : Number(data);
  if (!Number.isSafeInteger(usageCount) || usageCount < 0) {
    return NextResponse.json({ error: "Could not check option usage." }, { status: 500 });
  }
  return NextResponse.json({ usage_count: usageCount });
}

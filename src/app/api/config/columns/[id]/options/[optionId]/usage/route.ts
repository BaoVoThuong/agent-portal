import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { inactiveConfigValueResponse } from "@/lib/table-config/mutation-errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; optionId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id, optionId } = await params;
  const admin = await loadConfigAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { data, error } = await getSupabaseAdmin().rpc("table_column_option_usage_count", {
    p_column_id: id,
    p_option_id: optionId,
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

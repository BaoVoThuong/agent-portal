import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdminForScope } from "@/lib/table-config/access";
import { inactiveConfigValueResponse } from "@/lib/table-config/mutation-errors";
import { fetchTableColumnById } from "@/lib/table-config/queries";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; optionId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id, optionId } = await params;
  const supabase = getSupabaseAdmin();
  // Đếm chỗ đang dùng một option là bước ngay trước khi xoá nó, nên nó phải mở
  // cho đúng những người được xoá — kể cả người chỉ quản bảng lead.
  const column = await fetchTableColumnById(id, supabase);
  const admin = await loadConfigAdminForScope(column?.scope ?? "cs");
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { data, error } = await supabase.rpc("table_column_option_usage_count", {
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

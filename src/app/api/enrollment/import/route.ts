import { NextResponse } from "next/server";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { canActorImport } from "@/lib/table-config/export-access";
import { parseEnrollmentProgram } from "@/lib/enrollment/types";
import { processEnrollmentImportRows, type EnrollmentImportRowInput } from "@/lib/enrollment/import-rows";

export const dynamic = "force-dynamic";
const MAX_ROWS = 1000;

/**
 * Nhập hồ sơ Enrollment từ file Excel.
 *
 * Hai khác biệt CÓ Ý so với việc tạo/sửa từng hồ sơ trên màn hình:
 *
 * 1. **Đòi quyền `task.import` riêng.** Không suy ra từ `task.export` (chỉ đọc)
 *    cũng không suy ra từ vai trò quản lý: đây là đường GHI ĐÈ hàng loạt, một
 *    file sai sửa hàng trăm dòng trong một lượt.
 * 2. **Không bắn thông báo cho từng dòng.** Nhập một file 300 dòng mà mỗi dòng
 *    gửi một thông báo "hồ sơ mới được giao" là làm ngập hộp thông báo của cả
 *    đội vì một lần nạp dữ liệu. Cuối lượt phát MỘT tín hiệu realtime để các
 *    bảng đang mở tự nạp lại.
 */
export async function POST(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  if (!canActorImport(actorResult.permissions)) return NextResponse.json({ error: "You do not have permission to import." }, { status: 403 });
  const payload = (await request.json().catch(() => null)) as { program?: unknown; rows?: unknown } | null;
  const program = parseEnrollmentProgram(payload?.program);
  if (!program) return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  if (!payload || !Array.isArray(payload.rows)) return NextResponse.json({ error: "rows must be an array." }, { status: 400 });
  if (payload.rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} rows per import.` }, { status: 400 });
  const outcome = await processEnrollmentImportRows({
    program,
    rows: payload.rows as EnrollmentImportRowInput[],
    actorEmail: actorResult.actor.email,
    dryRun: false,
  });
  if (!outcome.ok) return outcome.response;
  return NextResponse.json(outcome.result);
}

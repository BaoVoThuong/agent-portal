import { NextResponse } from "next/server";
import { getTimeOffActor } from "@/lib/time-off/access";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TimeOffBalanceAdjustment } from "@/lib/time-off/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Ít hơn thì thiếu ngữ cảnh, nhiều hơn thì không ai đọc hết trong một modal. */
const HISTORY_LIMIT = 20;

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Lịch sử điều chỉnh quỹ của MỘT nhân viên, cho MỘT loại nghỉ.
 *
 * Tách khỏi payload của trang vì phép lọc phải nằm ở tầng truy vấn. Trang nạp
 * 200 dòng điều chỉnh mới nhất của TOÀN công ty rồi mới lọc ở trình duyệt —
 * mà tích luỹ hằng tháng ghi MỘT dòng cho MỖI nhân viên, tức 43 dòng mỗi
 * tháng. Chưa tới 5 tháng là cửa sổ 200 dòng đó chỉ còn toàn tích luỹ gần đây,
 * và một lần chỉnh tay từ nửa năm trước biến mất khỏi màn hình của chính người
 * bị chỉnh — đúng thứ mà một sổ audit không được phép làm.
 */
export async function GET(request: Request) {
  const actor = await getTimeOffActor();
  if (!actor) return error("Unauthorized", 401);
  if (!actor.canManage) {
    return error("Time Off Admin permission is required to read balance history.", 403);
  }

  const params = new URL(request.url).searchParams;
  const accountId = params.get("account_id")?.trim() ?? "";
  const policyCode = params.get("policy_code")?.trim() ?? "";
  const leaveYear = Number(params.get("leave_year"));
  if (!UUID.test(accountId)) return error("Choose an employee.");
  if (!policyCode) return error("Choose a leave type.");
  if (!Number.isInteger(leaveYear) || leaveYear < 2020 || leaveYear > 2200) {
    return error("Choose a valid leave year.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error: queryError } = await supabase
    .from("time_off_balance_adjustments")
    .select("id,account_id,policy_code,leave_year,effective_month,delta_days,source,note,created_by_id,created_at")
    .eq("account_id", accountId)
    .eq("policy_code", policyCode)
    .eq("leave_year", leaveYear)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (queryError) return error(queryError.message, 500);

  const rows = (data ?? []) as {
    id: string;
    account_id: string;
    policy_code: string;
    leave_year: number;
    effective_month: string;
    delta_days: number | string;
    source: TimeOffBalanceAdjustment["source"];
    note: string | null;
    created_by_id: string | null;
    created_at: string;
  }[];

  // Chỉ tra tên của những người thực sự xuất hiện. `created_by_id` là null cho
  // các dòng do lịch tự động sinh ra — đó là trạng thái hợp lệ, không phải lỗi.
  const actorIds = [...new Set(rows.map((row) => row.created_by_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: accounts } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("id,name,email")
      .in("id", actorIds);
    for (const account of (accounts ?? []) as { id: string; name: string | null; email: string }[]) {
      names.set(account.id, account.name?.trim() || account.email);
    }
  }

  const adjustments: TimeOffBalanceAdjustment[] = rows.map((row) => ({
    id: row.id,
    account_id: row.account_id,
    policy_code: row.policy_code,
    leave_year: row.leave_year,
    effective_month: row.effective_month,
    delta_days: Number(row.delta_days),
    source: row.source,
    note: row.note,
    created_by_name: row.created_by_id ? names.get(row.created_by_id) ?? "Unknown" : "Scheduled accrual",
    created_at: row.created_at,
  }));

  return NextResponse.json({ adjustments });
}

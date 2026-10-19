import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getUserAccessByEmail } from "@/lib/rbac/access";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await getUserAccessByEmail(email)).isActive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const hasIds = Array.isArray(body?.ids);
  // `read: false` with `ids` puts those notifications back to unread, so the
  // bell keeps them on the Unread tab like a to-do. Only the ids form takes it.
  const markUnread = hasIds && body?.read === false;
  const ids = hasIds
    ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string")
    : null;
  const taskId = typeof body?.taskId === "string" ? body.taskId.trim() : "";
  const recordId = typeof body?.recordId === "string" ? body.recordId.trim() : "";
  const type = typeof body?.type === "string" ? body.type.trim() : "";
  // Mark all read covers only what the bell had seen: rows created after this
  // instant arrived while the request travelled and stay unread.
  const before =
    typeof body?.before === "string" && Number.isFinite(Date.parse(body.before))
      ? body.before
      : null;

  const supabase = getSupabaseAdmin();
  if (hasIds) {
    const taskIds: string[] = [];
    const enrollmentIds: string[] = [];
    const timeOffIds: string[] = [];
    for (const id of ids ?? []) {
      if (id.startsWith("enrollment:")) enrollmentIds.push(id.slice("enrollment:".length));
      else if (id.startsWith("timeoff:")) timeOffIds.push(id.slice("timeoff:".length));
      else if (id.startsWith("task:")) taskIds.push(id.slice("task:".length));
      // Không có tiền tố = dữ liệu cũ, ghi trước khi chuông đọc nhiều nguồn.
      else taskIds.push(id);
    }
    const updates = [];
    if (taskIds.length > 0) {
      updates.push(
        supabase
          .from("task_notifications")
          .update({ is_read: !markUnread })
          .eq("recipient_email", email)
          .in("id", taskIds)
      );
    }
    if (enrollmentIds.length > 0) {
      updates.push(
        supabase
          .from("enrollment_notifications")
          .update({ is_read: !markUnread })
          .eq("recipient_email", email)
          .in("id", enrollmentIds)
      );
    }
    if (timeOffIds.length > 0) {
      updates.push(
        supabase
          .from("time_off_notifications")
          .update({ is_read: !markUnread })
          .eq("recipient_email", email)
          .in("id", timeOffIds)
      );
    }
    const results = await Promise.all(updates);
    const error = results.find(
      (result) => result.error && !isMissingOptionalTableError(result.error)
    )?.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (recordId) {
    let query = supabase
      .from("enrollment_notifications")
      .update({ is_read: true })
      .eq("recipient_email", email)
      .eq("record_id", recordId)
      .eq("is_read", false);
    if (type) query = query.eq("type", type);
    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!taskId) {
    let taskQuery = supabase
      .from("task_notifications")
      .update({ is_read: true })
      .eq("recipient_email", email)
      .eq("is_read", false);
    let enrollmentQuery = supabase
      .from("enrollment_notifications")
      .update({ is_read: true })
      .eq("recipient_email", email)
      .eq("is_read", false);
    // Bỏ sót bảng này là "Đánh dấu đã đọc tất cả" không bao giờ đưa chuông về 0:
    // phần đếm đã cộng cả ba nguồn, nên phần ghi cũng phải quét đủ ba.
    let timeOffQuery = supabase
      .from("time_off_notifications")
      .update({ is_read: true })
      .eq("recipient_email", email)
      .eq("is_read", false);
    if (before) {
      taskQuery = taskQuery.lte("created_at", before);
      enrollmentQuery = enrollmentQuery.lte("created_at", before);
      timeOffQuery = timeOffQuery.lte("created_at", before);
    }
    if (type) {
      taskQuery = taskQuery.eq("type", type);
      enrollmentQuery = enrollmentQuery.eq("type", type);
      timeOffQuery = timeOffQuery.eq("type", type);
    }
    const [taskRes, enrollmentRes, timeOffRes] = await Promise.all([
      taskQuery,
      enrollmentQuery,
      timeOffQuery,
    ]);
    if (taskRes.error) {
      return NextResponse.json({ error: taskRes.error.message }, { status: 500 });
    }
    if (enrollmentRes.error && !isMissingOptionalTableError(enrollmentRes.error)) {
      return NextResponse.json({ error: enrollmentRes.error.message }, { status: 500 });
    }
    if (timeOffRes.error && !isMissingOptionalTableError(timeOffRes.error)) {
      return NextResponse.json({ error: timeOffRes.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  let query = supabase
    .from("task_notifications")
    .update({ is_read: true })
    .eq("recipient_email", email)
    .eq("is_read", false);
  if (taskId) query = query.eq("task_id", taskId);
  if (type) query = query.eq("type", type);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Xem ghi chú cùng tên trong ../route.ts — bảng module phụ có thể chưa tồn tại. */
function isMissingOptionalTableError(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("enrollment_notifications") ||
    message.includes("time_off_notifications")
  );
}

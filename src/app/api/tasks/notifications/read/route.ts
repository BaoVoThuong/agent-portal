import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const hasIds = Array.isArray(body?.ids);
  const ids = hasIds
    ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string")
    : null;
  const taskId = typeof body?.taskId === "string" ? body.taskId.trim() : "";
  const recordId = typeof body?.recordId === "string" ? body.recordId.trim() : "";
  const type = typeof body?.type === "string" ? body.type.trim() : "";

  const supabase = getSupabaseAdmin();
  if (hasIds) {
    const taskIds: string[] = [];
    const enrollmentIds: string[] = [];
    for (const id of ids ?? []) {
      if (id.startsWith("enrollment:")) enrollmentIds.push(id.slice("enrollment:".length));
      else if (id.startsWith("task:")) taskIds.push(id.slice("task:".length));
      else taskIds.push(id);
    }
    const updates = [];
    if (taskIds.length > 0) {
      updates.push(
        supabase
          .from("task_notifications")
          .update({ is_read: true })
          .eq("recipient_email", email)
          .in("id", taskIds)
      );
    }
    if (enrollmentIds.length > 0) {
      updates.push(
        supabase
          .from("enrollment_notifications")
          .update({ is_read: true })
          .eq("recipient_email", email)
          .in("id", enrollmentIds)
      );
    }
    const results = await Promise.all(updates);
    const error = results.find(
      (result) => result.error && !isMissingEnrollmentTableError(result.error)
    )?.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (recordId) {
    let query = supabase
      .from("enrollment_notifications")
      .update({ is_read: true })
      .eq("recipient_email", email)
      .eq("record_id", recordId);
    if (type) query = query.eq("type", type);
    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!taskId) {
    let taskQuery = supabase
      .from("task_notifications")
      .update({ is_read: true })
      .eq("recipient_email", email);
    let enrollmentQuery = supabase
      .from("enrollment_notifications")
      .update({ is_read: true })
      .eq("recipient_email", email);
    if (type) {
      taskQuery = taskQuery.eq("type", type);
      enrollmentQuery = enrollmentQuery.eq("type", type);
    }
    const [taskRes, enrollmentRes] = await Promise.all([taskQuery, enrollmentQuery]);
    if (taskRes.error) {
      return NextResponse.json({ error: taskRes.error.message }, { status: 500 });
    }
    if (enrollmentRes.error && !isMissingEnrollmentTableError(enrollmentRes.error)) {
      return NextResponse.json({ error: enrollmentRes.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  let query = supabase
    .from("task_notifications")
    .update({ is_read: true })
    .eq("recipient_email", email);
  if (taskId) query = query.eq("task_id", taskId);
  if (type) query = query.eq("type", type);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function isMissingEnrollmentTableError(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("enrollment_notifications")
  );
}

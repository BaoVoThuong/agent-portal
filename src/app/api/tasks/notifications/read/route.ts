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
  const type = typeof body?.type === "string" ? body.type.trim() : "";

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("task_notifications")
    .update({ is_read: true })
    .eq("recipient_email", email);
  if (hasIds) {
    if (!ids || ids.length === 0) return NextResponse.json({ ok: true });
    query = query.in("id", ids);
  } else {
    if (taskId) query = query.eq("task_id", taskId);
    if (type) query = query.eq("type", type);
  }

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

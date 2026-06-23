import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_notifications")
    .select("id,task_id,type,actor_email,comment_id,is_read,created_at")
    .eq("recipient_email", email)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const notifications = data ?? [];
  const unread = notifications.filter((n) => !(n as { is_read: boolean }).is_read).length;
  return NextResponse.json({ notifications, unread });
}

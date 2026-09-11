import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Lưu / gỡ "địa chỉ đẩy" của MỘT MÁY.
 *
 * Xem docs/2026-09-10-web-push-notifications.md.
 *
 * Chủ sở hữu luôn lấy từ session, KHÔNG lấy từ body: nếu tin body thì bất kỳ ai
 * đăng nhập cũng đăng ký được thông báo dưới tên người khác — và nhận trọn nội
 * dung thông báo của họ.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SubscriptionBody = {
  subscription?: {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  userAgent?: unknown;
};

function readString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as SubscriptionBody | null;
  const endpoint = readString(body?.subscription?.endpoint, 2000);
  const p256dh = readString(body?.subscription?.keys?.p256dh, 500);
  const authKey = readString(body?.subscription?.keys?.auth, 500);
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "Invalid notification subscription." }, { status: 400 });
  }

  // upsert theo endpoint: cùng một máy đăng ký lại (đổi khoá VAPID, cài lại
  // trình duyệt) phải cập nhật dòng cũ chứ không tạo dòng thứ hai. Đây cũng là
  // đường một máy đổi chủ — endpoint giữ nguyên, recipient_email được ghi đè.
  const { error } = await getSupabaseAdmin().from("push_subscriptions").upsert(
    {
      endpoint,
      recipient_email: email,
      p256dh,
      auth: authKey,
      user_agent: readString(body?.userAgent, 400),
      failure_count: 0,
    },
    { onConflict: "endpoint" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = readString(body?.endpoint, 2000);
  if (!endpoint) {
    return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  }

  // Chỉ xoá được đăng ký CỦA MÌNH: biết endpoint của người khác cũng không tắt
  // được thông báo của họ.
  const { error } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("recipient_email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

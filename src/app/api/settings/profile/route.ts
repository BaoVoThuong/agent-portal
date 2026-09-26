import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasGrant } from "@/lib/authz/grants";
import { grantsForSession } from "@/lib/authz/principal";

export const dynamic = "force-dynamic";

/**
 * Tên hiển thị KHÔNG còn tự sửa được (2026-09-26, S1).
 *
 * Tên từng là khoá phạm vi của Registration / Agent Dashboard / AI chat. Từ
 * Phase D khoá đó là `agent_commission_names` (Account Manager đặt), nên tên
 * hiển thị KHÔNG còn quyết định dữ liệu ai thấy. Mở lại tự đổi tên hiển thị là
 * quyết định sản phẩm (Q4) — chưa làm. Giữ route để client cũ nhận 403 rõ ràng
 * thay vì 404.
 */
export async function PATCH() {
  const session = await auth();
  if (!session?.user?.email || !hasGrant(await grantsForSession(session), "settings.access")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Display name is managed by an administrator in Account Manager." },
    { status: 403 }
  );
}

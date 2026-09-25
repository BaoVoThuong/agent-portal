import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";

/**
 * Tên hiển thị KHÔNG còn tự sửa được (2026-09-26, S1).
 *
 * Tên là khoá phạm vi của Registration / Agent Dashboard / AI chat
 * (`fetchScopeAgentName`). Cho tự sửa là cho tự chọn xem dữ liệu hoa hồng của
 * ai. Chỉ Account Manager đổi tên, cho tới khi có bảng ánh xạ định danh.
 * Giữ route để client cũ nhận 403 rõ ràng thay vì 404.
 */
export async function PATCH() {
  const session = await auth();
  if (!session?.user?.email || !can(session.user.permissions, PERMISSIONS.SETTINGS)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Display name is managed by an administrator in Account Manager." },
    { status: 403 }
  );
}

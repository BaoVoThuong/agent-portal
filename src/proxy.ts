import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * Middleware của Next 16 (file này trước kia tên là `middleware.ts`).
 *
 * Dựng instance từ CẤU HÌNH NHẸ, tuyệt đối KHÔNG `import { auth } from "@/auth"`:
 * làm vậy là kéo bcryptjs + supabase-js + lớp RBAC vào bundle middleware và chạy
 * lại nhánh làm mới quyền cho mọi request — đo được 451 ms trước khi vào route
 * mỗi khi token quá hạn.
 *
 * Nó chỉ chặn người CHƯA ĐĂNG NHẬP. Quyền theo từng màn vẫn do
 * `requirePermission` / `requireAnyPermission` trong page và route gác.
 */
const { auth } = NextAuth(authConfig);
export const proxy = auth;

// api/enrollment/import/dry-run: Slack bot gọi từ server khác, không có phiên
// đăng nhập; route tự kiểm BOT_PORTAL_SECRET (2026-11-14).
export const config = {
  matcher: [
    "/((?!api/auth|api/cron|api/enrollment/import/dry-run|signin|_next/static|_next/image|favicon.ico|image|images|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};

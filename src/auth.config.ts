import type { NextAuthConfig } from "next-auth";

/**
 * Phần cấu hình auth mà `proxy.ts` (middleware của Next 16) được phép dùng.
 *
 * CỐ Ý KHÔNG có `providers` và KHÔNG có callback `jwt`/`session`.
 *
 * Vì sao quan trọng: middleware chạy trước MỌI trang và MỌI `/api/*`. Trước đây
 * `proxy.ts` export thẳng `auth` từ `@/auth`, nên mỗi request đều kéo theo
 * `bcryptjs`, `@supabase/supabase-js` và lớp RBAC — và tệ hơn, nó chạy luôn
 * nhánh làm mới quyền trong callback `jwt`.
 *
 * Số đo trên dev, token đã quá hạn 5 phút: phần TRƯỚC khi vào route tốn 451 ms,
 * rồi route lại làm mới thêm 308 ms nữa — hai vòng database cho cùng một việc.
 * Với token còn hạn thì chỉ 36 ms, nên đây là cú xóc mỗi 5 phút mỗi người chứ
 * không phải chi phí thường trực (bản plan đầu ghi sai điểm này).
 *
 * Ở đây middleware chỉ làm đúng một việc: mở khoá JWT rồi trả lời "đã đăng nhập
 * hay chưa". Không tra cứu gì.
 *
 * Việc kiểm QUYỀN thật vẫn nằm nguyên chỗ cũ — `requirePermission` /
 * `requireAnyPermission` trong từng page và route. Middleware chưa bao giờ là
 * nơi gác quyền, nó chỉ chặn người chưa đăng nhập.
 */
export const authConfig = {
  providers: [],
  pages: {
    signIn: "/signin",
    error: "/auth/error",
  },
  callbacks: {
    authorized: ({ auth }) => !!auth?.user?.email,
  },
} satisfies NextAuthConfig;

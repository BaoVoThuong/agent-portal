import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";

export type AvatarDirectoryEntry = { email: string; avatarUrl: string };

/**
 * Email → ảnh đại diện, cho TOÀN BỘ tài khoản đang hoạt động.
 *
 * Cố ý KHÔNG dùng `fetchTaskAssignees()`: hàm đó chỉ trả về người có quyền task.
 * Avatar còn hiện ở danh sách lead, ở TopBar, ở người tạo task — có người không
 * nằm trong danh sách ấy. Dùng nhầm thì hiện tượng sẽ là "ảnh hiện ở bảng task
 * nhưng không hiện ở lead", và phải lần khá lâu mới ra.
 *
 * Chỉ trả về người ĐÃ có ảnh: ai chưa đặt thì không cần chiếm chỗ trong payload,
 * và `Initials` mặc định đã là hai chữ viết tắt.
 *
 * Bọc `cache()` của React nên một lần dựng trang chỉ chạy một truy vấn, dù layout
 * và page cùng gọi.
 */
export const fetchAvatarDirectory = cache(
  async (): Promise<AvatarDirectoryEntry[]> => {
    const { data, error } = await getSupabaseAdmin()
      .from(PORTAL_ACCOUNT_TABLE)
      .select("email,avatar_url")
      .eq("is_active", true)
      .not("avatar_url", "is", null);

    // Ảnh đại diện là thứ trang trí. Truy vấn hỏng — hoặc cột chưa migrate —
    // thì trả danh sách rỗng để mọi người về lại hai chữ viết tắt, chứ không
    // làm chết cả layout và kéo theo toàn bộ ứng dụng.
    if (error) {
      console.error("Avatar directory lookup failed", error);
      return [];
    }

    return ((data ?? []) as { email: string | null; avatar_url: string | null }[])
      .flatMap((row) => {
        const email = row.email?.trim().toLowerCase();
        const avatarUrl = row.avatar_url?.trim();
        return email && avatarUrl ? [{ email, avatarUrl }] : [];
      });
  }
);

import { cache } from "react";
import { auth } from "@/auth";

/**
 * Phiên đăng nhập, chỉ giải mã MỘT lần cho mỗi lượt dựng trang.
 *
 * Layout và lớp kiểm quyền đều cần phiên, nên `auth()` bị gọi hai lần cho cùng
 * một request. `cache()` của React gộp chúng trong phạm vi MỘT request — không
 * có bộ nhớ đệm toàn tiến trình, nên không có chuyện quyền của người này rò
 * sang người khác.
 *
 * KHÔNG dùng trong `proxy.ts`: middleware chạy ngoài phạm vi request của React
 * nên `cache()` không với tới, và middleware đã dùng cấu hình nhẹ riêng.
 */
export const getSession = cache(async () => auth());

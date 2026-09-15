"use client";

import { createContext, useContext, useMemo } from "react";
import type { AvatarDirectoryEntry } from "./avatar-directory";

/**
 * Ảnh đại diện của cả công ty, nạp một lần ở layout.
 *
 * Vì sao là context chứ không phải prop: avatar hiện ở 34 chỗ, tất cả đều đi qua
 * component `Initials`. Truyền bằng prop thì phải nới mọi `labelByEmail` thành
 * object và sửa từng đường ống trung gian — phần lớn công sức của cả tính năng,
 * và hai map tên/ảnh có thể lệch nhau. Đọc từ context thì KHÔNG một call site
 * nào phải đổi.
 *
 * Làm được vì cả 15 file dùng `Initials` đều nằm trong cây client, và danh bạ
 * rất nhỏ: chỉ những người ĐÃ đặt ảnh, mỗi dòng hai trường.
 */

const AvatarContext = createContext<ReadonlyMap<string, string>>(new Map());

export function AvatarProvider({
  entries,
  children,
}: {
  entries: AvatarDirectoryEntry[];
  children: React.ReactNode;
}) {
  const map = useMemo(
    () => new Map(entries.map((entry) => [entry.email, entry.avatarUrl])),
    [entries]
  );
  return <AvatarContext.Provider value={map}>{children}</AvatarContext.Provider>;
}

/**
 * URL ảnh của một người, hoặc null.
 *
 * null là câu trả lời bình thường, không phải lỗi: người chưa đặt ảnh, hoặc
 * component đang render ngoài provider (Storybook, test). Cả hai trường hợp
 * `Initials` đều vẽ hai chữ viết tắt như trước.
 */
export function useAvatarUrl(email: string | null | undefined): string | null {
  const map = useContext(AvatarContext);
  if (!email) return null;
  return map.get(email.trim().toLowerCase()) ?? null;
}

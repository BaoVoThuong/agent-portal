"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Khoá theo key (id dòng, `alerts:<userId>`…) thay cho một cờ `busy` chung khoá
 * cả bảng. Kiểm bằng ref nên bấm đúp trong cùng một tick vẫn bị chặn; `pending`
 * là bản state để render.
 */
export function usePendingKeys() {
  const live = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  /** false nếu key đang chạy: bỏ qua lượt bấm này. */
  const start = useCallback((key: string) => {
    if (live.current.has(key)) return false;
    live.current.add(key);
    setPending(new Set(live.current));
    return true;
  }, []);
  const finish = useCallback((key: string) => {
    if (!live.current.delete(key)) return;
    setPending(new Set(live.current));
  }, []);
  return { pending, start, finish };
}

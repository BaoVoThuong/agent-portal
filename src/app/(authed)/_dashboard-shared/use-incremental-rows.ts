"use client";

import { useEffect, useRef, useState, type UIEvent } from "react";

const SCROLL_LOAD_THRESHOLD_PX = 400;

// Dựng trước một phần bảng dài, cuộn gần đáy thì dựng thêm. Danh sách đổi
// (lọc, sắp xếp) thì quay lại phần đầu. Export vẫn dùng danh sách đầy đủ.
export function useIncrementalRows<T>(rows: T[], step = 100) {
  const [progress, setProgress] = useState({ limit: step, rows });
  const scrollRef = useRef<HTMLDivElement>(null);
  const limit = progress.rows === rows ? progress.limit : step;

  useEffect(() => {
    // Khi lọc/sắp xếp, phần bảng hiển thị quay về đầu và vị trí cuộn cũng vậy.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [rows]);

  function handleScroll(event: UIEvent<HTMLElement>) {
    const element = event.currentTarget;
    const distanceToBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    if (distanceToBottom < SCROLL_LOAD_THRESHOLD_PX && limit < rows.length) {
      setProgress({ limit: limit + step, rows });
    }
  }

  return { handleScroll, scrollRef, visibleRows: rows.slice(0, limit) };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { uploadWithConcurrency } from "@/lib/attachments/background-uploads";
import type { ToastTone } from "./Toast";

export type BackgroundUploadNotice = { message: string; tone: ToastTone };

/**
 * Tải file đính kèm chạy nền sau khi form tạo đã đóng (plan instant feedback
 * T2.1/T2.3): tối đa 3 file cùng lúc, báo tiến trình bằng một toast, và nhắc
 * người dùng nếu họ đóng tab khi còn file đang tải.
 *
 * `beforeunload` chỉ là lời nhắc, không bảo đảm file tải xong. File lỗi thì
 * toast nói rõ tên file và chỗ để đính kèm lại.
 */
export function useBackgroundUploads() {
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState<BackgroundUploadNotice | null>(null);

  useEffect(() => {
    if (active === 0) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [active]);

  const run = useCallback(
    async <T,>({
      label,
      items,
      nameOf,
      upload,
      retryHint,
    }: {
      /** Mã hiển thị của bản ghi, vd "CS-123", "LD12". */
      label: string;
      items: readonly T[];
      nameOf: (item: T) => string;
      upload: (item: T) => Promise<boolean>;
      /** Câu chỉ chỗ đính kèm lại khi có file lỗi. */
      retryHint: string;
    }): Promise<T[]> => {
      if (items.length === 0) return [];
      const total = items.length;
      const noun = total === 1 ? "file" : "files";
      let settled = 0;
      setActive((count) => count + 1);
      setNotice({ message: `Uploading ${total} ${noun} to ${label}…`, tone: "info" });
      try {
        const failed = await uploadWithConcurrency(items, upload, {
          onSettled: () => {
            settled += 1;
            if (settled < total) {
              setNotice({
                message: `Uploading ${noun} to ${label}… ${settled}/${total}`,
                tone: "info",
              });
            }
          },
        });
        setNotice(
          failed.length === 0
            ? {
                message: total === 1 ? `File attached to ${label}.` : `${total} files attached to ${label}.`,
                tone: "success",
              }
            : {
                message: `${failed.length} of ${total} ${noun} did not upload to ${label}: ${failed
                  .map(nameOf)
                  .join(", ")}. ${retryHint}`,
                tone: "error",
              },
        );
        return failed;
      } finally {
        setActive((count) => Math.max(0, count - 1));
      }
    },
    [],
  );

  const dismiss = useCallback(() => setNotice(null), []);

  return { run, notice, dismiss, active };
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useBodyScrollLock } from "../../_shared/useBodyScrollLock";

export type AttachmentPreview = {
  url: string;
  fileName: string;
  mimeType: string | null;
  trigger?: HTMLElement | null;
};

const PREVIEWABLE_IMAGE_MIMES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const INLINE_PREVIEW_MIMES = new Set([
  "application/pdf",
  "text/csv",
  "text/plain",
]);
const PREVIEW_ZOOM_MIN = 0.5;
const PREVIEW_ZOOM_MAX = 3;
const PREVIEW_ZOOM_STEP = 0.25;
/** Ảnh chụp bằng điện thoại hay bị nằm ngang; bốn nấc 90° là đủ để dựng lại. */
const PREVIEW_ROTATION_STEP = 90;

export function canPreviewAttachment(mime: string | null): boolean {
  return Boolean(
    mime &&
      (PREVIEWABLE_IMAGE_MIMES.has(mime) || INLINE_PREVIEW_MIMES.has(mime)),
  );
}

export function isPreviewableImage(mime: string | null): boolean {
  return Boolean(mime && PREVIEWABLE_IMAGE_MIMES.has(mime));
}

export function isInlinePreview(mime: string | null): boolean {
  return Boolean(mime && INLINE_PREVIEW_MIMES.has(mime));
}

export function AttachmentPreviewDialog({
  preview,
  onClose,
}: {
  preview: AttachmentPreview | null;
  onClose: () => void;
}) {
  const [previewStatus, setPreviewStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewRotation, setPreviewRotation] = useState(0);
  const previewCloseRef = useRef<HTMLButtonElement | null>(null);
  const previewDialogRef = useRef<HTMLDivElement | null>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);

  // Khoá nền qua hook chung: bản tự viết ở đây lưu overflow cũ rồi khôi
  // phục khi đóng, nên đóng modal trong lúc một modal khác còn mở là mở
  // khoá cả nền. Hook đếm số modal đang mở nên lồng nhau vẫn đúng.
  useBodyScrollLock(Boolean(preview));

  // Mở ảnh khác thì trả zoom/góc xoay/trạng thái tải về mặc định. Không có
  // bước này thì phóng to ảnh A rồi mở ảnh B là B hiện ở 300% và xoay 90 độ —
  // người dùng không hiểu vì sao, vì họ đâu có chạm vào nút nào.
  //
  // Chỉnh ngay trong render chứ không dùng useEffect: đây là mẫu "điều chỉnh
  // state khi prop đổi" của React, và React Compiler cấm gọi setState trong
  // thân effect. Làm ở đây còn tránh được một nhịp vẽ ảnh mới bằng zoom cũ.
  const previewUrl = preview?.url ?? null;
  const [lastPreviewUrl, setLastPreviewUrl] = useState(previewUrl);
  if (previewUrl !== lastPreviewUrl) {
    setLastPreviewUrl(previewUrl);
    setPreviewZoom(1);
    setPreviewRotation(0);
    setPreviewStatus("loading");
  }

  useEffect(() => {
    if (!preview) return;
    previewTriggerRef.current = preview.trigger ?? (document.activeElement as HTMLElement | null);
    const focusFrame = window.requestAnimationFrame(() => previewCloseRef.current?.focus());

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setPreviewZoom((current) =>
          Math.min(PREVIEW_ZOOM_MAX, current + PREVIEW_ZOOM_STEP),
        );
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        setPreviewZoom((current) =>
          Math.max(PREVIEW_ZOOM_MIN, current - PREVIEW_ZOOM_STEP),
        );
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        setPreviewZoom(1);
        setPreviewRotation(0);
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        setPreviewRotation((current) => (current + PREVIEW_ROTATION_STEP) % 360);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = previewDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href]:not([aria-disabled="true"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
    };
  }, [onClose, preview]);

  if (!preview) return null;

  const previewIsImage = isPreviewableImage(preview.mimeType);
  const previewIsInlineFile = isInlinePreview(preview.mimeType);

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[#091e42]/70 p-4"
      onClick={onClose}
    >
      <div
        ref={previewDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attachment-preview-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#dfe1e6] px-4 py-2.5">
          <h2
            id="attachment-preview-title"
            className="min-w-0 truncate text-sm font-bold text-[#172b4d]"
            title={preview.fileName}
          >
            {preview.fileName}
          </h2>
          <button
            ref={previewCloseRef}
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded p-1 text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#f7f8f9] p-3">
          {previewIsImage ? (
            <>
              {previewStatus === "loading" ? (
                <p className="px-4 py-8 text-sm font-semibold text-[#6b778c]" role="status">
                  Loading preview…
                </p>
              ) : null}
              {previewStatus === "error" ? (
                <div className="px-4 py-8 text-center" role="alert">
                  <p className="text-sm font-semibold text-[#bf2600]">Preview unavailable.</p>
                  <p className="mt-1 text-xs text-[#6b778c]">The signed link may have expired.</p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  setPreviewZoom((current) =>
                    current >= PREVIEW_ZOOM_MAX
                      ? 1
                      : Math.min(PREVIEW_ZOOM_MAX, current + 0.5),
                  )
                }
                disabled={previewStatus !== "loaded"}
                aria-label={previewZoom >= PREVIEW_ZOOM_MAX ? "Reset image zoom" : "Zoom in image"}
                className={`border-0 bg-transparent p-0 outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-[#85b8ff] disabled:pointer-events-none ${previewZoom >= PREVIEW_ZOOM_MAX ? "cursor-zoom-out" : "cursor-zoom-in"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.url}
                  alt={preview.fileName}
                  onLoad={() => setPreviewStatus("loaded")}
                  onError={() => setPreviewStatus("error")}
                  className={`object-contain transition-transform duration-150 ${previewStatus === "loaded" ? "" : "hidden"}`}
                  style={{
                    transform: `rotate(${previewRotation}deg) scale(${previewZoom})`,
                    transformOrigin: "center center",
                    // Khung vuông, GIỮ NGUYÊN ở cả bốn góc xoay.
                    //
                    // CSS transform không đổi ô chiếm chỗ của ảnh, nên nếu để
                    // giới hạn khác nhau theo góc thì mỗi lần bấm xoay ảnh lại
                    // nhảy to nhỏ — vừa giật mắt vừa làm mất chỗ đang nhìn.
                    // Chặn cả hai chiều bằng CÙNG một số thì cạnh dài sau khi
                    // xoay vẫn nằm trong khung, nên kích thước bất động.
                    //
                    // Đánh đổi: ảnh nằm ngang hiển thị nhỏ hơn mức tối đa nó có
                    // thể. Đó là cái giá của việc xoay không nhảy — và đã có
                    // nút phóng to cho ai cần nhìn kỹ.
                    maxWidth: "min(100%, calc(100vh - 12rem))",
                    maxHeight: "calc(100vh - 12rem)",
                  }}
                />
              </button>
            </>
          ) : previewIsInlineFile ? (
            <iframe
              src={preview.url}
              title={`Preview of ${preview.fileName}`}
              className="h-full min-h-[min(70vh,48rem)] w-full rounded border border-[#dfe1e6] bg-white"
            />
          ) : (
            <div className="max-w-md px-4 py-8 text-center">
              <FileText className="mx-auto h-10 w-10 text-[#97a0af]" />
              <p className="mt-3 text-sm font-semibold text-[#44546f]">
                Preview is not available for this file type.
              </p>
              <p className="mt-1 text-xs text-[#6b778c]">
                Use Download to view the file with a compatible application.
              </p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#dfe1e6] px-4 py-2.5">
          {previewIsImage ? (
            <div className="flex items-center gap-1 rounded border border-[#dfe1e6] bg-[#fafbfc] p-1" aria-label="Image zoom controls">
              <button
                type="button"
                onClick={() => setPreviewZoom((current) => Math.max(PREVIEW_ZOOM_MIN, current - PREVIEW_ZOOM_STEP))}
                disabled={previewZoom <= PREVIEW_ZOOM_MIN}
                aria-label="Zoom out"
                title="Zoom out"
                className="inline-flex h-8 w-8 items-center justify-center rounded text-[#44546f] transition hover:bg-[#e9f2ff] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreviewZoom(1);
                  setPreviewRotation(0);
                }}
                aria-label="Reset image zoom and rotation"
                title="Reset zoom and rotation (0)"
                className="min-w-14 rounded px-2 py-1.5 text-xs font-semibold text-[#44546f] transition hover:bg-[#e9f2ff] hover:text-[#0c66e4]"
              >
                {Math.round(previewZoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setPreviewZoom((current) => Math.min(PREVIEW_ZOOM_MAX, current + PREVIEW_ZOOM_STEP))}
                disabled={previewZoom >= PREVIEW_ZOOM_MAX}
                aria-label="Zoom in"
                title="Zoom in"
                className="inline-flex h-8 w-8 items-center justify-center rounded text-[#44546f] transition hover:bg-[#e9f2ff] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              {/* Trước đây nút này mang biểu tượng xoay nhưng lại reset zoom —
                  trùng việc với nút phần trăm ngay bên trái. Nay nó làm đúng
                  việc mà hình vẽ của nó hứa hẹn. */}
              <button
                type="button"
                onClick={() =>
                  setPreviewRotation((current) => (current + PREVIEW_ROTATION_STEP) % 360)
                }
                disabled={previewStatus !== "loaded"}
                aria-label="Rotate image 90 degrees clockwise"
                title="Rotate 90° (R)"
                className="inline-flex h-8 w-8 items-center justify-center rounded text-[#44546f] transition hover:bg-[#e9f2ff] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCw className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <span className="text-xs font-semibold text-[#6b778c]">
              {previewIsInlineFile ? "File preview" : "File attachment"}
            </span>
          )}
          <div className="flex items-center justify-end gap-2">
            <a
              href={preview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded px-3 py-1.5 text-sm font-semibold text-[#0c66e4] hover:bg-[#e9f2ff]"
            >
              Open
            </a>
            <a
              href={preview.url}
              download={preview.fileName}
              className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0055cc]"
            >
              Download
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

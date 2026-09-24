"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useBodyScrollLock } from "../../_shared/useBodyScrollLock";
import { toAttachmentDownloadUrl } from "@/lib/tasks/attachment-download";
import {
  clampPanOffset,
  rotatedScaledBounds,
  zoomAtPoint,
  type PanOffset,
  type Size,
} from "@/lib/tasks/preview-pan";

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
const PREVIEW_ZOOM_MAX = 6;
const PREVIEW_ZOOM_STEP = 0.25;
/** Kéo dưới ngưỡng này thì coi là một cú bấm, không phải kéo. */
const PREVIEW_DRAG_SLOP = 4;
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
  const [previewOffset, setPreviewOffset] = useState<PanOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  // Kích thước LÚC CHƯA phóng của ảnh, và của khung. Để trong state chứ không
  // đọc DOM lúc render: đọc ref khi render vừa sai luật React vừa không đáng
  // tin — lần render đầu ref còn null, và đổi cỡ cửa sổ thì không ai vẽ lại.
  const [baseSize, setBaseSize] = useState<Size | null>(null);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 0, height: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; from: PanOffset; moved: boolean } | null>(null);
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
    setPreviewOffset({ x: 0, y: 0 });
    setBaseSize(null);
    setPreviewStatus("loading");
  }

  /** Hộp bao hiện tại của ảnh; null khi ảnh chưa tải xong nên chưa đo được. */
  const boundsFor = useCallback(
    (scale: number, rotation: number) =>
      baseSize ? rotatedScaledBounds(baseSize, rotation, scale) : null,
    [baseSize],
  );

  /** Đổi mức phóng và kéo lại offset cho hợp lệ trong một nhịp. */
  const applyZoom = useCallback(
    (nextZoomRaw: number, pointer?: PanOffset) => {
      const nextZoom = Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, nextZoomRaw));
      setPreviewZoom((currentZoom) => {
        setPreviewOffset((currentOffset) => {
          const moved = pointer
            ? zoomAtPoint(currentOffset, pointer, currentZoom, nextZoom)
            : {
                x: (currentOffset.x * nextZoom) / currentZoom,
                y: (currentOffset.y * nextZoom) / currentZoom,
              };
          const bounds = boundsFor(nextZoom, previewRotation);
          return bounds ? clampPanOffset(moved, bounds, viewportSize) : { x: 0, y: 0 };
        });
        return nextZoom;
      });
    },
    [boundsFor, previewRotation, viewportSize],
  );

  /**
   * Bắt đầu kéo ảnh.
   *
   * Gắn `pointermove`/`pointerup` lên `window` chứ không dựa vào
   * `setPointerCapture` trên phần tử: kéo ra ngoài phần tử, ra ngoài cả cửa sổ,
   * hay nhả chuột ở đâu cũng vẫn nhận được sự kiện. Bản trước bắt sự kiện trên
   * chính thẻ ảnh nên chỉ cần con trỏ rời khỏi nó là mất dấu.
   *
   * Đặt trên KHUNG chứ không trên thẻ ảnh: ảnh cao thì hai bên còn dải nền xám,
   * bấm vào đó rồi kéo là chuyện rất tự nhiên, mà bản trước không nhận.
   */
  const startDrag = (event: React.PointerEvent) => {
    if (event.button !== 0 || previewStatus !== "loaded") return;
    const drag = { x: event.clientX, y: event.clientY, from: previewOffset, moved: false };
    dragRef.current = drag;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - drag.x;
      const dy = moveEvent.clientY - drag.y;
      // Dưới ngưỡng thì vẫn coi là một cú bấm, để nút phóng-khi-bấm không mất.
      if (!drag.moved && Math.hypot(dx, dy) < PREVIEW_DRAG_SLOP) return;
      if (!drag.moved) {
        drag.moved = true;
        setDragging(true);
      }
      const next = { x: drag.from.x + dx, y: drag.from.y + dy };
      setPreviewOffset(
        currentBounds ? clampPanOffset(next, currentBounds, viewportSize) : next,
      );
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  const resetView = useCallback(() => {
    setPreviewZoom(1);
    setPreviewRotation(0);
    setPreviewOffset({ x: 0, y: 0 });
  }, []);

  /** Ảnh có tràn khung không — không tràn thì không có gì để kéo. */
  const currentBounds = boundsFor(previewZoom, previewRotation);
  const pannable = Boolean(
    currentBounds &&
      (currentBounds.width > viewportSize.width + 1 ||
        currentBounds.height > viewportSize.height + 1),
  );
  // Một nguồn duy nhất cho con trỏ, dùng chung cho cả khung lẫn thẻ ảnh — hai
  // nơi tự quyết là có lúc rê qua ranh giới thì con trỏ nhấp nháy đổi qua lại.
  const imageCursor = dragging
    ? "cursor-grabbing"
    : pannable
      ? "cursor-grab"
      : previewZoom >= PREVIEW_ZOOM_MAX
        ? "cursor-zoom-out"
        : "cursor-zoom-in";

  // Đo ảnh và khung bằng ResizeObserver, KHÔNG đo trong `onLoad`.
  //
  // Đo trong onLoad là lỗi đã gặp: lúc sự kiện đó chạy, ảnh vẫn mang class
  // `hidden` của lần render trước (trạng thái còn là "loading"), tức
  // `display:none`, nên `offsetWidth` trả về 0. Hộp bao thành 0 → không bao giờ
  // coi là tràn khung → không có bàn tay và không kéo được gì, dù zoom 150%.
  //
  // ResizeObserver đo đúng ba thời điểm cần: lúc ảnh hiện ra, lúc đổi cỡ cửa sổ
  // (khung rộng hẹp đi thì phần tràn cũng đổi), và lúc ảnh khác được mở.
  // `transform` không đổi ô chiếm chỗ nên số đo được luôn là cỡ CHƯA phóng —
  // đúng thứ `rotatedScaledBounds` cần.
  useEffect(() => {
    if (!preview) return;
    const viewport = viewportRef.current;
    const image = imageRef.current;
    const measure = () => {
      if (viewport) {
        setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
      }
      // Bỏ qua số đo 0: ảnh đang ẩn hoặc chưa bố trí xong, ghi vào state chỉ để
      // lại một hộp bao rỗng cho tới lần đo sau.
      if (image && image.offsetWidth > 0 && image.offsetHeight > 0) {
        setBaseSize({ width: image.offsetWidth, height: image.offsetHeight });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport) observer.observe(viewport);
    if (image) observer.observe(image);
    return () => observer.disconnect();
  }, [preview]);

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
        applyZoom(previewZoom + PREVIEW_ZOOM_STEP);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        applyZoom(previewZoom - PREVIEW_ZOOM_STEP);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetView();
        return;
      }
      // Kéo bằng bàn phím. Ảnh nằm trong một <button> nên nó nhận được focus;
      // không có nhánh này thì người dùng bàn phím phóng to được mà không xem
      // được phần bị tràn ra ngoài khung.
      const PAN_KEYS: Record<string, PanOffset> = {
        ArrowLeft: { x: 1, y: 0 },
        ArrowRight: { x: -1, y: 0 },
        ArrowUp: { x: 0, y: 1 },
        ArrowDown: { x: 0, y: -1 },
      };
      const direction = PAN_KEYS[event.key];
      if (direction) {
        event.preventDefault();
        const step = event.shiftKey ? 120 : 40;
        setPreviewOffset((current) => {
          const next = { x: current.x + direction.x * step, y: current.y + direction.y * step };
          const bounds = boundsFor(previewZoom, previewRotation);
          return bounds ? clampPanOffset(next, bounds, viewportSize) : current;
        });
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        setPreviewRotation((current) => (current + PREVIEW_ROTATION_STEP) % 360);
        setPreviewOffset({ x: 0, y: 0 });
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
  }, [applyZoom, boundsFor, onClose, preview, previewRotation, previewZoom, resetView, viewportSize]);

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

        {/* Ảnh dùng khung riêng: `overflow-hidden` + kéo bằng transform.
            Bản cũ để `overflow-auto` và trông chờ thanh cuộn, nhưng
            `transform: scale()` KHÔNG làm phần tử chiếm thêm chỗ, nên khung
            cuộn không thấy có gì tràn và thanh cuộn không bao giờ hiện —
            phóng to xong là không đi đâu được. Tệ hơn: `items-center` trên
            một khung cuộn thì phần tràn ở mép TRÁI/TRÊN nằm ngoài vùng cuộn
            được, nên kể cả có thanh cuộn cũng không với tới được nửa bên trái. */}
        <div
          ref={viewportRef}
          onPointerDown={previewIsImage ? startDrag : undefined}
          onWheel={
            previewIsImage
              ? (event) => {
                  if (previewStatus !== "loaded") return;
                  const viewport = viewportRef.current;
                  if (!viewport) return;
                  const rect = viewport.getBoundingClientRect();
                  applyZoom(previewZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), {
                    x: event.clientX - (rect.left + rect.width / 2),
                    y: event.clientY - (rect.top + rect.height / 2),
                  });
                }
              : undefined
          }
          className={`relative flex min-h-0 flex-1 items-center justify-center bg-[#f7f8f9] p-3 ${
            previewIsImage ? `touch-none overflow-hidden ${imageCursor}` : "overflow-auto"
          }`}
        >
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
                onClick={(event) => {
                  // Vừa kéo xong thì KHÔNG phóng. `pointerup` chạy trước
                  // `click`, nên cờ `moved` vẫn còn đọc được ở đây.
                  if (dragRef.current?.moved) return;
                  if (previewStatus !== "loaded") return;
                  if (previewZoom >= PREVIEW_ZOOM_MAX) {
                    resetView();
                    return;
                  }
                  const viewport = viewportRef.current;
                  const rect = viewport?.getBoundingClientRect();
                  applyZoom(
                    previewZoom + 0.5,
                    rect
                      ? {
                          x: event.clientX - (rect.left + rect.width / 2),
                          y: event.clientY - (rect.top + rect.height / 2),
                        }
                      : undefined,
                  );
                }}
                disabled={previewStatus !== "loaded"}
                aria-label={previewZoom >= PREVIEW_ZOOM_MAX ? "Reset image zoom" : "Zoom in image"}
                className={`border-0 bg-transparent p-0 outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-[#85b8ff] disabled:pointer-events-none ${imageCursor}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.url}
                  alt={preview.fileName}
                  onLoad={() => setPreviewStatus("loaded")}
                  onError={() => setPreviewStatus("error")}
                  ref={imageRef}
                  draggable={false}
                  className={`object-contain ${dragging ? "" : "transition-transform duration-150"} ${previewStatus === "loaded" ? "" : "hidden"}`}
                  style={{
                    // `translate` đứng TRƯỚC `scale`: dịch chuyển tính bằng pixel
                    // trên màn hình, không bị nhân lên theo mức phóng.
                    transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) rotate(${previewRotation}deg) scale(${previewZoom})`,
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
                onClick={() => applyZoom(previewZoom - PREVIEW_ZOOM_STEP)}
                disabled={previewZoom <= PREVIEW_ZOOM_MIN}
                aria-label="Zoom out"
                title="Zoom out"
                className="inline-flex h-8 w-8 items-center justify-center rounded text-[#44546f] transition hover:bg-[#e9f2ff] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={resetView}
                aria-label="Reset image zoom and rotation"
                title="Reset zoom and rotation (0)"
                className="min-w-14 rounded px-2 py-1.5 text-xs font-semibold text-[#44546f] transition hover:bg-[#e9f2ff] hover:text-[#0c66e4]"
              >
                {Math.round(previewZoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => applyZoom(previewZoom + PREVIEW_ZOOM_STEP)}
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
                  {
                    setPreviewRotation((current) => (current + PREVIEW_ROTATION_STEP) % 360);
                    // Giữ nguyên offset sau khi xoay là phần đang xem nhảy sang
                    // một chỗ khác hẳn, vì hai trục vừa đổi chỗ cho nhau.
                    setPreviewOffset({ x: 0, y: 0 });
                  }
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
              href={toAttachmentDownloadUrl(preview.url, preview.fileName)}
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

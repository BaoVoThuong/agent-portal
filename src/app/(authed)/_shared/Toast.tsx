"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export type ToastTone = "info" | "success" | "error";

const TONE_CLASS: Record<ToastTone, string> = {
  info: "bg-[#172b4d] text-white",
  success: "bg-[#216e4e] text-white",
  error: "bg-[#ae2a19] text-white",
};

/**
 * Floating status message. Deliberately `fixed` and outside the document flow:
 * these used to be inline banners that pushed the page content down when they
 * appeared and yanked it back up when they cleared, which made tables jump
 * under the cursor mid-interaction.
 *
 * Renders nothing when `message` is null, so callers can mount it
 * unconditionally.
 */
export function Toast({
  message,
  tone = "info",
  onDismiss,
  autoDismissMs = 5000,
  stackIndex = 0,
}: {
  message: string | null;
  tone?: ToastTone;
  onDismiss: () => void;
  /** null disables auto-dismiss (message stays until dismissed). */
  autoDismissMs?: number | null;
  /** 0 = bottom-most. Use 1, 2… to stack several toasts on one screen. */
  stackIndex?: number;
}) {
  // Held in a ref so an inline arrow from the parent doesn't restart the
  // countdown on every parent render — the timer must depend only on which
  // message is showing and for how long.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!message || autoDismissMs === null) return;
    const timer = window.setTimeout(() => onDismissRef.current(), autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [message, autoDismissMs]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ bottom: `${1.25 + stackIndex * 3.25}rem` }}
      className={`fixed left-1/2 z-[200] flex max-w-lg -translate-x-1/2 items-center gap-3 rounded px-4 py-2.5 text-sm font-medium shadow-[0_8px_24px_rgba(9,30,66,0.32)] ${TONE_CLASS[tone]}`}
    >
      <span className="min-w-0">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 rounded p-1 opacity-70 transition hover:bg-white/15 hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

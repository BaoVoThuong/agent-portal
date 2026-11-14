"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Khung và nút chép từ ProviderEditDialog / ProviderFormFields / ProviderCollabPanel
// để dialog licensing trông y như dialog sửa Provider (user 14/11).
export const GHOST_BUTTON =
  "inline-flex h-9 items-center rounded px-4 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:cursor-not-allowed disabled:opacity-40 max-md:h-11";
export const PRIMARY_BUTTON =
  "inline-flex h-9 items-center gap-1.5 rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40 max-md:h-11";
export const DANGER_BUTTON =
  "inline-flex h-9 items-center rounded bg-[#c9372c] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#ae2e24] disabled:cursor-not-allowed disabled:opacity-40 max-md:h-11";
export const ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d] disabled:cursor-not-allowed disabled:opacity-40";
export const BADGE = "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold";

export const INPUT =
  "h-9 w-full rounded border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-sm font-semibold text-[#172b4d] outline-none transition placeholder:font-normal placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:bg-[#f4f5f7] disabled:text-[#6b778c] max-md:h-11";
export const TEXTAREA = `${INPUT} !h-auto min-h-[96px] resize-y py-2 leading-6`;
export const LABEL = "mb-1 block text-xs font-bold uppercase tracking-wide text-[#6b778c]";
/** Nút TaskSelect trong form: viền 2px cao 36px như ô nhập bên cạnh. */
export const SELECT_BUTTON =
  "!h-9 !w-full !rounded-lg !border-2 !border-[#dfe1e6] !bg-white !px-2 !text-sm !font-semibold !shadow-none max-md:!h-11";
export const INVALID_RING = "!ring-2 !ring-[#ff5630] !ring-offset-1";

export const STATUS_PILL = {
  active: "bg-[#dcfff1] text-[#216e4e]",
  pending: "bg-[#fff7d6] text-[#7f5f01]",
  terminated: "bg-[#f1f2f4] text-[#626f86]",
} as const;

/**
 * Khung 2 cột: form trái, panel phải. `wide=false` bỏ panel (dialog thêm mới).
 * Cao theo nội dung (tối đa 760px) chứ không cố định như Provider: form licensing
 * ngắn, cố định là để trống nửa dưới (user 14/11).
 */
export function RecordDialog({
  label,
  title,
  subtitle,
  busy,
  wide = true,
  onClose,
  panel,
  footer,
  children,
}: {
  label: string;
  title: ReactNode;
  subtitle?: ReactNode;
  busy?: boolean;
  wide?: boolean;
  onClose: () => void;
  panel?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6 max-md:p-0"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`flex w-full flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)] max-md:h-full max-md:max-h-none max-md:rounded-none ${
          wide ? "max-h-[min(760px,calc(100dvh-3rem))] max-w-[1080px]" : "max-h-[calc(100dvh-3rem)] max-w-3xl"
        }`}
      >
        <header className="flex shrink-0 items-start gap-4 border-b border-[#dfe1e6] px-6 py-4 max-md:px-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold text-[#172b4d]">{title}</h2>
            {subtitle ? (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm text-[#626f86]">{subtitle}</div>
            ) : null}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className={ICON_BUTTON}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div
          className={`min-h-0 flex-1 overflow-y-auto ${
            panel ? "lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden" : ""
          }`}
        >
          <div className="bg-white px-6 py-5 max-md:px-4 lg:min-h-0 lg:overflow-y-auto">{children}</div>
          {panel ? (
            <section className="flex min-h-[16rem] min-w-0 flex-col gap-3 border-t border-[#dfe1e6] bg-[#fafbfc] p-4 lg:h-full lg:min-h-[18rem] lg:border-l lg:border-t-0">
              {panel}
            </section>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[#dfe1e6] bg-white px-6 py-4 max-md:px-4">
          {footer}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Tab của panel phải, như Comments | Activity bên Provider. */
export function PanelTab({ label, count, active = true }: { label: string; count?: number | null; active?: boolean }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-5 border-b border-[#dfe1e6]">
      <span
        aria-current={active ? "page" : undefined}
        className="-mb-px inline-flex items-center gap-1.5 border-b-2 border-[#0c66e4] px-1 pb-2 text-sm font-semibold text-[#0c66e4]"
      >
        {label}
        {typeof count === "number" ? (
          <span className="rounded-full bg-[#e9f2ff] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[#0c66e4]">
            {count}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Ô chỉ-đọc hàng cuối form, kiểu "Opened by" của Provider / Task. */
export function ReadOnlyCell({ label, title, className = "", children }: {
  label: string;
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className={LABEL}>{label}</span>
      <div
        title={title}
        className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 text-sm font-medium text-[#172b4d] max-md:h-11"
      >
        {children ?? <span className="font-normal text-[#97a0af]">—</span>}
      </div>
    </div>
  );
}

/** Đường kẻ giữa các nhóm ô trong lưới 12 cột. */
export function GroupDivider() {
  return <div aria-hidden="true" className="col-span-12 my-0.5 border-t border-[#dfe1e6]" />;
}

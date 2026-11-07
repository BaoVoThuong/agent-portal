"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, SlidersHorizontal } from "lucide-react";

const PHONE_BUTTON_CLASS =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#42526e] md:hidden";

/** Opens a filter row that stays collapsed on a phone, with the number of filters in use. */
export function PhoneFilterToggle({
  open,
  onToggle,
  activeCount,
}: {
  open: boolean;
  onToggle: () => void;
  activeCount: number;
}) {
  return (
    <button type="button" className={PHONE_BUTTON_CLASS} aria-expanded={open} onClick={onToggle}>
      <SlidersHorizontal className="h-4 w-4" />
      Filters
      {activeCount > 0 ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e9f2ff] px-1 text-[11px] font-bold text-[#0c66e4]">
          {activeCount}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Secondary page actions behind a "more" button on a phone. `md:contents` leaves
 * the children as direct items of the action row from the tablet width up.
 */
export function PhoneMoreActions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`${PHONE_BUTTON_CLASS} w-11 px-0`}
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      <div className={`gap-2 md:contents ${open ? "flex w-full flex-wrap" : "hidden"}`}>{children}</div>
    </>
  );
}

export type PhoneCardField = { label: string; value: ReactNode };

/** One row of a list on a phone: the identifier, what it is, its state, then who and when. */
export function PhoneCard({
  recordKey,
  title,
  badges,
  fields,
  onOpen,
  ariaLabel,
  tone = "default",
  leading,
  actions,
}: {
  recordKey?: string;
  title: ReactNode;
  badges?: ReactNode;
  fields: PhoneCardField[];
  onOpen: () => void;
  ariaLabel: string;
  tone?: "default" | "alert";
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`flex gap-3 rounded-lg border p-3 outline-none transition-colors focus-visible:border-[#0c66e4] ${
        tone === "alert"
          ? "border-[#ffbdad] bg-[#fff5f3] active:bg-[#ffebe6]"
          : "border-[#dfe1e6] bg-white active:bg-[#f7f8f9]"
      }`}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {recordKey ? (
            <span className="mr-0.5 text-xs font-semibold tabular-nums text-[#6b778c]">{recordKey}</span>
          ) : null}
          {badges}
        </div>
        <div className="mt-1 line-clamp-2 break-words text-[15px] font-semibold leading-snug text-[#172b4d]">
          {title}
        </div>
        {fields.length > 0 ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {fields.map((field) => (
              <div key={field.label} className="min-w-0">
                <dt className="text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">{field.label}</dt>
                <dd className="truncate text-[13px] text-[#172b4d]">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {actions ? <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function PhoneBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "blue" | "red" }) {
  const toneClass =
    tone === "red"
      ? "bg-[#ffebe6] text-[#bf2600]"
      : tone === "blue"
        ? "bg-[#e9f2ff] text-[#0c66e4]"
        : "bg-[#f1f2f4] text-[#44546f]";
  return (
    <span className={`max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${toneClass}`}>
      {children}
    </span>
  );
}

const PAGE_SIZE = 30;

/** Renders a page at a time, so a long list stays light on a phone, then asks the page for more. */
export function PhoneCardList<T>({
  items,
  getKey,
  renderItem,
  hasMore = false,
  onEndReached,
}: {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  hasMore?: boolean;
  onEndReached?: () => void;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const shown = items.slice(0, limit);
  const canGrow = limit < items.length || hasMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !canGrow || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (limit < items.length) setLimit((current) => current + PAGE_SIZE);
        else onEndReached?.();
      },
      { rootMargin: "480px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canGrow, limit, items.length, onEndReached]);

  return (
    <ul className="flex flex-col gap-2">
      {shown.map((item) => (
        <li key={getKey(item)}>{renderItem(item)}</li>
      ))}
      {canGrow ? <li ref={sentinelRef} aria-hidden="true" className="h-2" /> : null}
    </ul>
  );
}

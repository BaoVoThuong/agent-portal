"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentHealthPerformanceFiltering } from "./AgentHealthPerformanceFilterState";

type AgentHealthCarrierMultiSelectFilterProps = {
  options: string[];
  selectedCarriers: string[];
};

export function AgentHealthCarrierMultiSelectFilter({
  options,
  selectedCarriers,
}: AgentHealthCarrierMultiSelectFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const beginFiltering = useAgentHealthPerformanceFiltering();
  const [isOpen, setIsOpen] = useState(false);
  const [draftSelected, setDraftSelected] = useState(selectedCarriers);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [isOpen]);

  const label = useMemo(() => {
    if (selectedCarriers.length === 0) return "All carriers";
    if (selectedCarriers.length === 1) return selectedCarriers[0];
    return `${selectedCarriers.length} carriers`;
  }, [selectedCarriers]);

  const selectedSet = useMemo(() => new Set(draftSelected), [draftSelected]);

  function toggleCarrier(carrier: string) {
    setDraftSelected((current) =>
      current.includes(carrier)
        ? current.filter((item) => item !== carrier)
        : [...current, carrier]
    );
  }

  function closeWithoutApplying() {
    setDraftSelected(selectedCarriers);
    setIsOpen(false);
  }

  function clearCarriers() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("carrier");
    setDraftSelected([]);
    setIsOpen(false);
    const query = params.toString();
    pushFilterUrl(query);
  }

  function applyCarriers() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("carrier");

    for (const carrier of draftSelected) {
      params.append("carrier", carrier);
    }

    setIsOpen(false);
    const query = params.toString();
    pushFilterUrl(query);
  }

  function pushFilterUrl(query: string) {
    const nextHref = query ? `${pathname}?${query}` : pathname;
    const currentQuery = searchParams.toString();
    const currentHref = currentQuery ? `${pathname}?${currentQuery}` : pathname;

    if (nextHref !== currentHref) {
      beginFiltering();
    }

    router.push(nextHref);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-9 min-w-[11rem] items-center justify-between gap-2 rounded-lg border border-[#cfd7e3] bg-white px-3 text-left text-xs font-semibold text-[#16233a] shadow-[0_1px_3px_rgba(22,35,58,0.08)] transition hover:border-[#184e8a] focus:outline-none focus:ring-2 focus:ring-[#184e8a]/15"
        aria-expanded={isOpen}
      >
        <span className="truncate">{label}</span>
        <span className="text-[#667085]" aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-30 mt-2 w-[min(18rem,calc(100vw-1rem))] rounded-lg border border-[#d8dee7] bg-white p-3 shadow-[0_12px_28px_rgba(22,35,58,0.14)]">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#667085]">
            Carrier
          </div>
          <div className="max-h-64 overflow-auto pr-1">
            {options.length === 0 ? (
              <div className="rounded-md border border-dashed border-[#d8dee7] px-3 py-8 text-center text-xs text-[#667085]">
                No carriers available.
              </div>
            ) : (
              options.map((carrier) => (
                <label
                  key={carrier}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[#16233a] transition hover:bg-[#f3f6fa]"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(carrier)}
                    onChange={() => toggleCarrier(carrier)}
                    className="h-4 w-4 rounded border-[#cfd7e3] accent-[#184e8a]"
                  />
                  <span className="truncate">{carrier}</span>
                </label>
              ))
            )}
          </div>

          <div className="mt-3 flex items-center justify-end gap-2 border-t border-[#edf0f4] pt-3">
            <button
              type="button"
              onClick={clearCarriers}
              className="mr-auto h-7 rounded px-2 text-xs font-semibold text-[#667085] transition hover:bg-[#f3f6fa] hover:text-[#16233a]"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={closeWithoutApplying}
              className="h-7 rounded px-2 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyCarriers}
              className="h-7 rounded px-2 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentHealthDashboardFiltering } from "./AgentHealthDashboardFilterState";

type AgentHealthCarrierMultiSelectFilterProps = {
  onSelectedCarriersChange?: (carriers: string[]) => void;
  options: string[];
  selectedCarriers: string[];
};

export function AgentHealthCarrierMultiSelectFilter({
  onSelectedCarriersChange,
  options,
  selectedCarriers,
}: AgentHealthCarrierMultiSelectFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const beginFiltering = useAgentHealthDashboardFiltering();
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

  function toggleDropdown() {
    setDraftSelected(selectedCarriers);
    setIsOpen((current) => !current);
  }

  function closeWithoutApplying() {
    setDraftSelected(selectedCarriers);
    setIsOpen(false);
  }

  function clearCarriers() {
    if (onSelectedCarriersChange) {
      setDraftSelected([]);
      setIsOpen(false);
      onSelectedCarriersChange([]);
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("carrier");
    setDraftSelected([]);
    setIsOpen(false);
    const query = params.toString();
    pushFilterUrl(query);
  }

  function applyCarriers() {
    if (onSelectedCarriersChange) {
      setIsOpen(false);
      onSelectedCarriersChange(draftSelected);
      return;
    }

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
        onClick={toggleDropdown}
        className="dashboard-filter-button min-w-[12.5rem]"
        aria-expanded={isOpen}
      >
        <span className="truncate">{label}</span>
        <span className="text-[#667085]" aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className="dashboard-filter-menu absolute right-0 z-30 mt-2.5 w-[min(18rem,calc(100vw-1rem))] p-3.5">
          <div className="dashboard-filter-title mb-2.5">
            Carrier
          </div>
          <div className="max-h-64 overflow-auto pr-1">
            {options.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#d8dee7] px-3 py-8 text-center text-sm font-semibold text-[#667085]">
                No carriers available.
              </div>
            ) : (
              options.map((carrier) => (
                <label
                  key={carrier}
                  className="dashboard-filter-option"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(carrier)}
                    onChange={() => toggleCarrier(carrier)}
                    className="dashboard-filter-checkbox"
                  />
                  <span className="truncate">{carrier}</span>
                </label>
              ))
            )}
          </div>

          <div className="dashboard-filter-footer mt-3">
            <button
              type="button"
              onClick={clearCarriers}
              className="dashboard-filter-action mr-auto text-[#667085]"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={closeWithoutApplying}
              className="dashboard-filter-action"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyCarriers}
              className="dashboard-filter-action"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

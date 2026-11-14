"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { PhoneFilterToggle } from "@/app/(authed)/_shared/phone-ui";
import { TaskSelect, type TaskSelectOption } from "@/app/(authed)/tasks/_components/TaskSelect";
import type { LicensingStatus } from "@/lib/health-licensing/types";
import { activeFilterCount, DEFAULT_FILTERS, STATUS_LABEL, type LicensingFilters } from "./licensing-view";

/** Cùng chuỗi lớp nút lọc của TaskToolbar / LeadsClient / ProviderToolbar. */
const FILTER_SELECT_BUTTON_CLASS =
  "max-md:!h-11 !h-9 !w-full !min-w-0 !rounded-lg !border !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";

const STATUS_OPTIONS: TaskSelectOption[] = (["active", "pending", "terminated"] as const).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));

export type LicensingView = "map" | "table";

/** Bố cục theo ProviderToolbar: công tắc view + ô tìm, rồi một hàng lọc. */
export function LicensingToolbar({
  view,
  onViewChange,
  tableCount,
  filters,
  onFilters,
  options,
  resultCount,
  totalCount,
}: {
  view: LicensingView;
  onViewChange: (view: LicensingView) => void;
  tableCount: number;
  filters: LicensingFilters;
  onFilters: (filters: LicensingFilters) => void;
  options: {
    states: TaskSelectOption[];
    products: TaskSelectOption[];
    carriers: TaskSelectOption[];
    agents: TaskSelectOption[];
  };
  resultCount: number;
  totalCount: number;
}) {
  const [phoneFiltersOpen, setPhoneFiltersOpen] = useState(false);
  const filterCount = activeFilterCount(filters);

  return (
    <section className="mt-2 flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3 max-md:flex-wrap">
        <nav aria-label="State Licensing view" className="inline-flex shrink-0 rounded-lg bg-[#f4f5f7] p-0.5">
          {(
            [
              ["map", "Map"],
              ["table", "Table"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onViewChange(key)}
              aria-current={view === key ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                view === key ? "bg-white text-[#0c66e4] shadow-sm" : "text-[#5e6c84] hover:text-[#172b4d]"
              }`}
            >
              {label}
              {key === "table" && tableCount ? (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                    view === key ? "bg-[#e9f2ff] text-[#0c66e4]" : "bg-[#dfe1e6] text-[#44546f]"
                  }`}
                >
                  {tableCount}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="relative min-w-0 flex-1 max-md:min-w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
          <input
            autoComplete="off"
            value={filters.query}
            onChange={(event) => onFilters({ ...filters, query: event.target.value })}
            placeholder="Search carrier or state…"
            aria-label="Search carrier or state"
            className="h-10 w-full rounded-lg border-2 border-transparent bg-[#f4f5f7] pl-10 pr-9 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#44546f] hover:bg-[#ebecf0] focus:border-[#0c66e4] focus:bg-white"
          />
          {filters.query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onFilters({ ...filters, query: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#7a869a] transition hover:bg-[#ebecf0] hover:text-[#172b4d]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2 max-md:flex-wrap">
        <div
          className={`mobile-filter-grid flex min-w-0 flex-1 items-center gap-2 max-md:basis-full max-md:flex-wrap ${
            phoneFiltersOpen ? "" : "max-md:!hidden"
          }`}
        >
          <TaskSelect
            multi
            searchable
            values={filters.states}
            options={options.states}
            placeholder="State"
            summaryLabel="states"
            className="w-[6.5rem] shrink-0"
            buttonClassName={FILTER_SELECT_BUTTON_CLASS}
            onValuesChange={(values) => onFilters({ ...filters, states: values })}
          />
          <TaskSelect
            multi
            values={filters.products}
            options={options.products}
            placeholder="Product"
            summaryLabel="products"
            className="w-[8rem] shrink-0"
            buttonClassName={FILTER_SELECT_BUTTON_CLASS}
            onValuesChange={(values) => onFilters({ ...filters, products: values })}
          />
          <TaskSelect
            multi
            searchable
            values={filters.carriers}
            options={options.carriers}
            placeholder="Carrier"
            summaryLabel="carriers"
            className="w-[7.5rem] shrink-0"
            buttonClassName={FILTER_SELECT_BUTTON_CLASS}
            onValuesChange={(values) => onFilters({ ...filters, carriers: values })}
          />
          <TaskSelect
            multi
            values={filters.statuses}
            options={STATUS_OPTIONS}
            placeholder="Status"
            summaryLabel="statuses"
            className="w-[8.5rem] shrink-0"
            buttonClassName={FILTER_SELECT_BUTTON_CLASS}
            onValuesChange={(values) => onFilters({ ...filters, statuses: values as LicensingStatus[] })}
          />
          {options.agents.length ? (
            <TaskSelect
              multi
              searchable
              values={filters.agents}
              options={options.agents}
              placeholder="Agent"
              summaryLabel="agents"
              className="w-[7rem] shrink-0"
              buttonClassName={FILTER_SELECT_BUTTON_CLASS}
              onValuesChange={(values) => onFilters({ ...filters, agents: values })}
            />
          ) : null}
          {filterCount > 0 ? (
            <button
              type="button"
              onClick={() => onFilters({ ...DEFAULT_FILTERS, query: filters.query })}
              className="h-9 shrink-0 px-1 text-sm font-medium text-[#0c66e4] transition hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 max-md:w-full max-md:justify-between">
          <PhoneFilterToggle
            open={phoneFiltersOpen}
            onToggle={() => setPhoneFiltersOpen((current) => !current)}
            activeCount={filterCount}
          />
          <span aria-live="polite" className="mobile-filter-count whitespace-nowrap text-sm font-medium text-[#626f86]">
            {resultCount} of {totalCount} states
          </span>
        </div>
      </div>
    </section>
  );
}

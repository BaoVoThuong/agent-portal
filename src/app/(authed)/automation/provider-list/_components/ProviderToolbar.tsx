"use client";

import { Search, X } from "lucide-react";
import { TaskSelect } from "../../../tasks/_components/TaskSelect";
import {
  EMPTY_PROVIDER_FILTERS,
  hasActiveProviderFilters,
  type ProviderFilters,
} from "@/lib/providers/search";

/**
 * Cùng chuỗi lớp mà TaskToolbar và LeadsClient đang dùng cho nút filter. Hằng
 * đó khai cục bộ ở cả hai nơi và không được export, nên chép lại là cách duy
 * nhất để ba bảng trông giống nhau thật.
 */
const FILTER_SELECT_BUTTON_CLASS =
  "!h-9 !rounded-lg !border !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";

const SOURCE_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "sheet", label: "From Sheet" },
  { value: "manual", label: "Added here" },
];

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ value, label: value }));
}

export function ProviderToolbar({
  query,
  onQuery,
  filters,
  onFilters,
  options,
  resultCount,
  totalCount,
}: {
  query: string;
  onQuery: (value: string) => void;
  filters: ProviderFilters;
  onFilters: (filters: ProviderFilters) => void;
  options: {
    state: string[];
    city: string[];
    specialty: string[];
    accepting: string[];
  };
  resultCount: number;
  totalCount: number;
}) {
  const active = hasActiveProviderFilters(filters) || query.trim() !== "";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* Ô tìm kiếm chiếm trọn một hàng: nó là thứ được dùng nhiều nhất, và
          đứng chung hàng với năm dropdown thì bị bóp lại còn một mẩu ở màn
          hình hẹp. */}
      <div className="relative w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b778c]" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search doctor, clinic, NPI, phone, city, ZIP…"
          aria-label="Search providers"
          className="h-9 w-full rounded-lg border border-[#dfe1e6] bg-white pl-9 pr-3 text-sm font-medium text-[#172b4d] outline-none transition focus:border-[#0c66e4]"
        />
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <TaskSelect
          multi
          searchable
          values={filters.state}
          options={toOptions(options.state)}
          placeholder="State"
          summaryLabel="states"
          className="w-max min-w-[8rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onValuesChange={(values) => onFilters({ ...filters, state: values })}
        />

        <TaskSelect
          multi
          searchable
          values={filters.city}
          options={toOptions(options.city)}
          placeholder="City"
          summaryLabel="cities"
          className="w-max min-w-[9rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onValuesChange={(values) => onFilters({ ...filters, city: values })}
        />

        <TaskSelect
          multi
          searchable
          values={filters.specialty}
          options={toOptions(options.specialty)}
          placeholder="Specialty"
          summaryLabel="specialties"
          className="w-max min-w-[10rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onValuesChange={(values) => onFilters({ ...filters, specialty: values })}
        />

        <TaskSelect
          multi
          values={filters.accepting}
          options={toOptions(options.accepting)}
          placeholder="Accepting patients"
          summaryLabel="answers"
          className="w-max min-w-[11rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onValuesChange={(values) => onFilters({ ...filters, accepting: values })}
        />

        <TaskSelect
          value={filters.source}
          options={SOURCE_OPTIONS}
          placeholder="All sources"
          className="w-max min-w-[9rem]"
          buttonClassName={FILTER_SELECT_BUTTON_CLASS}
          onChange={(value) =>
            onFilters({ ...filters, source: value as ProviderFilters["source"] })
          }
        />

        {active ? (
          <button
            type="button"
            onClick={() => {
              onQuery("");
              onFilters(EMPTY_PROVIDER_FILTERS);
            }}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        ) : null}

        {active ? (
          <span className="text-xs font-semibold text-[#6b778c]">
            {resultCount} of {totalCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}

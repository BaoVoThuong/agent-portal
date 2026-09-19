"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { TaskSelect } from "../../../tasks/_components/TaskSelect";
import type { ProviderFilters } from "@/lib/providers/search";

/**
 * Cùng chuỗi lớp mà TaskToolbar và LeadsClient đang dùng cho nút filter. Hằng
 * đó khai cục bộ ở cả hai nơi và không được export, nên chép lại là cách duy
 * nhất để ba bảng trông giống nhau thật.
 */
const FILTER_SELECT_BUTTON_CLASS =
  "!h-9 !w-full !min-w-0 !rounded-lg !border !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";

/**
 * Lọc theo việc địa chỉ có tra cứu được trong Provider Finder không.
 *
 * Một ô chọn ĐƠN, không phải multi: ba trạng thái này loại trừ nhau, chọn cả
 * "dùng được" lẫn "không dùng được" thì bằng không lọc gì.
 */
const ADDRESS_OPTIONS = [
  { value: "", label: "All" },
  { value: "valid", label: "Has address" },
  { value: "invalid", label: "No address" },
];

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ value, label: value }));
}

export function ProviderToolbar({
  views,
  view,
  onViewChange,
  query,
  onQuery,
  filters,
  onFilters,
  options,
  resultCount,
  totalCount,
  settingsSlot,
}: {
  views: readonly { key: "list" | "finder"; label: string }[];
  view: "list" | "finder";
  onViewChange: (view: "list" | "finder") => void;
  query: string;
  onQuery: (value: string) => void;
  filters: ProviderFilters;
  onFilters: (filters: ProviderFilters) => void;
  options: {
    state: string[];
    city: string[];
    specialty: string[];
    acaPlans: string[];
    medicarePlans: string[];
  };
  resultCount: number;
  totalCount: number;
  /**
   * Nút chọn cột, đứng trước số lượng provider. Nhận vào dạng chỗ cắm thay vì ba tham số
   * cấu hình cột: thanh công cụ không cần biết gì về chuyện ẩn/hiện cột, và
   * hàng lọc này vốn đã tự ẩn ở tab tìm theo địa chỉ nên nút cũng ẩn theo.
   */
  settingsSlot?: ReactNode;
}) {
  return (
    <section className="mt-2 flex min-w-0 flex-col gap-3">
      {/* Theo bố cục CS Tasks: view switcher đứng cố định bên trái search,
          không bị cuốn theo dãy filter hoặc đổi chỗ khi bảng co chiều ngang. */}
      <div className="flex min-w-0 items-center gap-3">
        <nav
          aria-label="Provider List view"
          className="inline-flex shrink-0 rounded-lg bg-[#f4f5f7] p-0.5"
        >
          {views.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => onViewChange(option.key)}
              aria-current={view === option.key ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                view === option.key
                  ? "bg-white text-[#0c66e4] shadow-sm"
                  : "text-[#5e6c84] hover:text-[#172b4d]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </nav>

        {view === "list" ? (
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
            <input
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Search doctor, clinic, NPI, phone, city, ZIP…"
              aria-label="Search providers"
              className="h-10 w-full rounded-lg border-2 border-transparent bg-[#f4f5f7] pl-10 pr-9 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#44546f] hover:bg-[#ebecf0] focus:border-[#0c66e4] focus:bg-white"
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1" aria-hidden="true" />
        )}
      </div>

      {view === "list" ? (
        <div className="flex min-w-0 items-center gap-2">
          {/* Một hàng duy nhất: chật thì cuộn ngang chứ không xuống hàng, để
              chiều cao thanh lọc không nhảy khi thu hẹp cửa sổ. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            <TaskSelect
              multi
              searchable
              values={filters.state}
              options={toOptions(options.state)}
              placeholder="State"
              summaryLabel="states"
              className="w-[6.5rem] shrink-0"
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
              className="w-[6.5rem] shrink-0"
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
              className="w-[8rem] shrink-0"
              buttonClassName={FILTER_SELECT_BUTTON_CLASS}
              onValuesChange={(values) => onFilters({ ...filters, specialty: values })}
            />

            <TaskSelect
              multi
              searchable
              values={filters.acaPlans}
              options={toOptions(options.acaPlans)}
              placeholder="ACA plans"
              summaryLabel="plans"
              className="w-[8.5rem] shrink-0"
              buttonClassName={FILTER_SELECT_BUTTON_CLASS}
              onValuesChange={(values) => onFilters({ ...filters, acaPlans: values })}
            />

            <TaskSelect
              multi
              searchable
              values={filters.medicarePlans}
              options={toOptions(options.medicarePlans)}
              placeholder="Medicare plans"
              summaryLabel="plans"
              className="w-[9.5rem] shrink-0"
              buttonClassName={FILTER_SELECT_BUTTON_CLASS}
              onValuesChange={(values) => onFilters({ ...filters, medicarePlans: values })}
            />

            <TaskSelect
              value={filters.address}
              options={ADDRESS_OPTIONS}
              placeholder="Address"
              className="w-[9.25rem] shrink-0"
              buttonClassName={FILTER_SELECT_BUTTON_CLASS}
              onChange={(value) =>
                onFilters({ ...filters, address: value as ProviderFilters["address"] })
              }
            />
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            {settingsSlot ? <div className="shrink-0">{settingsSlot}</div> : null}

            <span
              aria-live="polite"
              className="whitespace-nowrap text-[13px] font-semibold text-[#6b778c]"
            >
              {resultCount} of {totalCount} providers
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

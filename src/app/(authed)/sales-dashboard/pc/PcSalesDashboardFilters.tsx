"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ReportMonthDefaultEditor,
  type ReportMonthDefaultConfig,
} from "../../_components/ReportMonthDefaultEditor";

type FilterOptions = {
  agents: string[];
  agencies: string[];
};

type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

type FilterValues = {
  policyNumber: string;
  agent: string;
  agency: string;
  reportMonthRange: ReportMonthRange;
};

type ClientFilterValues = Pick<FilterValues, "agency" | "agent" | "policyNumber">;

type StringFilterName = "policyNumber" | "agent" | "agency";

export function PcSalesHeaderFilters({
  defaultConfig,
  filters,
}: {
  defaultConfig: ReportMonthDefaultConfig;
  filters: FilterValues;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function replaceWithParams(params: URLSearchParams) {
    const query = params.toString();

    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <ReportMonthRangeDropdown
        defaultConfig={defaultConfig}
        disabled={isPending}
        endDate={filters.reportMonthRange.end}
        startDate={filters.reportMonthRange.start}
        onApply={(range) => {
          const params = new URLSearchParams(searchParams.toString());
          params.delete("reportMonth");

          if (!range.start && !range.end) {
            params.set("reportMonthRange", "all");
          } else {
            params.delete("reportMonthRange");
          }

          if (range.start) {
            params.set("start", range.start);
          } else {
            params.delete("start");
          }

          if (range.end) {
            params.set("end", range.end);
          } else {
            params.delete("end");
          }

          replaceWithParams(params);
        }}
      />
    </div>
  );
}

export function PcSalesDashboardFilters({
  filters,
  onClientFiltersChange,
  options,
}: {
  filters: FilterValues;
  onClientFiltersChange?: (filters: ClientFilterValues) => void;
  options: FilterOptions;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [policyNumber, setPolicyNumber] = useState(filters.policyNumber);

  function replaceWithParams(params: URLSearchParams) {
    const query = params.toString();

    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }

  function updateParam(name: StringFilterName, value: string) {
    if (onClientFiltersChange) {
      onClientFiltersChange({
        agency: name === "agency" ? value : filters.agency,
        agent: name === "agent" ? value : filters.agent,
        policyNumber:
          name === "policyNumber" ? value : filters.policyNumber,
      });
      return;
    }

    const params = new URLSearchParams(searchParams.toString());

    if (value) {
      params.set(name, value);
    } else {
      params.delete(name);
    }

    replaceWithParams(params);
  }

  function applyPolicyNumberFilter() {
    updateParam("policyNumber", policyNumber.trim());
  }

  return (
    <div className="mb-8 grid gap-8 lg:grid-cols-3">
      <FilterSelect
        disabled={isPending}
        label="Agency"
        name="agency"
        onChange={(value) => updateParam("agency", value)}
        options={options.agencies}
        value={filters.agency}
      />
      <FilterSelect
        disabled={isPending}
        label="Agent"
        name="agent"
        onChange={(value) => updateParam("agent", value)}
        options={options.agents}
        value={filters.agent}
      />
      <label className="block">
        <span className="sr-only">Policy Number</span>
        <input
          aria-label="Policy Number"
          className="dashboard-filter-input"
          disabled={isPending}
          onBlur={applyPolicyNumberFilter}
          onChange={(event) => setPolicyNumber(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyPolicyNumberFilter();
            }
          }}
          placeholder="Policy Number"
          type="search"
          value={policyNumber}
        />
      </label>
    </div>
  );
}

function ReportMonthRangeDropdown({
  defaultConfig,
  disabled,
  endDate,
  startDate,
  onApply,
}: {
  defaultConfig: ReportMonthDefaultConfig;
  disabled: boolean;
  endDate: string | null;
  startDate: string | null;
  onApply: (range: ReportMonthRange) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draftStartMonth, setDraftStartMonth] = useState(() =>
    dateToMonthValue(startDate)
  );
  const [draftEndMonth, setDraftEndMonth] = useState(() =>
    dateToMonthValue(endDate)
  );
  const [startYear, setStartYear] = useState(() =>
    monthValueToYear(dateToMonthValue(startDate) || dateToMonthValue(endDate))
  );
  const [endYear, setEndYear] = useState(() =>
    monthValueToYear(dateToMonthValue(endDate) || dateToMonthValue(startDate))
  );
  const label = useMemo(() => {
    if (!startDate && !endDate) return "All report months";
    if (startDate && endDate) {
      return `${formatMonthLabel(startDate)} - ${formatMonthLabel(endDate)}`;
    }

    if (startDate) return `From ${formatMonthLabel(startDate)}`;
    return `Through ${formatMonthLabel(endDate ?? "")}`;
  }, [endDate, startDate]);

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

  function closeWithoutApplying() {
    const nextStartMonth = dateToMonthValue(startDate);
    const nextEndMonth = dateToMonthValue(endDate);

    setDraftStartMonth(nextStartMonth);
    setDraftEndMonth(nextEndMonth);
    setStartYear(monthValueToYear(nextStartMonth || nextEndMonth));
    setEndYear(monthValueToYear(nextEndMonth || nextStartMonth));
    setIsOpen(false);
  }

  function clearRange() {
    setDraftStartMonth("");
    setDraftEndMonth("");
    setIsOpen(false);
    onApply({ start: null, end: null });
  }

  function applyRange() {
    let nextStartMonth = draftStartMonth;
    let nextEndMonth = draftEndMonth;

    if (
      nextStartMonth &&
      nextEndMonth &&
      nextStartMonth.localeCompare(nextEndMonth) > 0
    ) {
      [nextStartMonth, nextEndMonth] = [nextEndMonth, nextStartMonth];
    }

    setIsOpen(false);
    onApply({
      start: nextStartMonth ? monthValueToDate(nextStartMonth) : null,
      end: nextEndMonth ? monthValueToDate(nextEndMonth) : null,
    });
  }

  function selectStartMonth(value: string) {
    setDraftStartMonth(value);
    if (draftEndMonth && value.localeCompare(draftEndMonth) > 0) {
      setDraftEndMonth(value);
      setEndYear(monthValueToYear(value));
    }
  }

  function selectEndMonth(value: string) {
    setDraftEndMonth(value);
    if (draftStartMonth && draftStartMonth.localeCompare(value) > 0) {
      setDraftStartMonth(value);
      setStartYear(monthValueToYear(value));
    }
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        disabled={disabled}
        className="dashboard-filter-button w-[14.5rem]"
        aria-expanded={isOpen}
      >
        <span className="truncate">{label}</span>
        <span className="text-[#667085]" aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className="dashboard-filter-menu absolute right-0 z-30 mt-2.5 w-[min(27rem,calc(100vw-1rem))] p-3.5">
          <div className="grid grid-cols-2 gap-4">
            <MonthPanel
              title="Start Month"
              year={startYear}
              selectedMonth={draftStartMonth}
              rangeStart={draftStartMonth}
              rangeEnd={draftEndMonth}
              onSelect={selectStartMonth}
              onPreviousYear={() => setStartYear((current) => current - 1)}
              onNextYear={() => setStartYear((current) => current + 1)}
            />
            <MonthPanel
              title="End Month"
              year={endYear}
              selectedMonth={draftEndMonth}
              rangeStart={draftStartMonth}
              rangeEnd={draftEndMonth}
              onSelect={selectEndMonth}
              onPreviousYear={() => setEndYear((current) => current - 1)}
              onNextYear={() => setEndYear((current) => current + 1)}
            />
          </div>

          <div className="dashboard-filter-footer mt-3">
            <ReportMonthDefaultEditor defaultConfig={defaultConfig} />
            <button
              type="button"
              onClick={clearRange}
              className="dashboard-filter-action text-[#667085]"
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
              onClick={applyRange}
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

function MonthPanel({
  title,
  year,
  selectedMonth,
  rangeStart,
  rangeEnd,
  onSelect,
  onPreviousYear,
  onNextYear,
}: {
  title: string;
  year: number;
  selectedMonth: string;
  rangeStart: string;
  rangeEnd: string;
  onSelect: (value: string) => void;
  onPreviousYear: () => void;
  onNextYear: () => void;
}) {
  return (
    <section>
      <div className="mb-2 text-center text-xs font-bold text-[#24272d]">
        {title}
      </div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onPreviousYear}
          className="flex h-6 w-6 items-center justify-center rounded-full text-base leading-none text-[#24272d] transition hover:bg-[#f3f6fa]"
          aria-label={`Previous year for ${title}`}
        >
          ‹
        </button>
        <div className="text-sm font-bold text-[#24272d]">
          {year}
        </div>
        <button
          type="button"
          onClick={onNextYear}
          className="flex h-6 w-6 items-center justify-center rounded-full text-base leading-none text-[#24272d] transition hover:bg-[#f3f6fa]"
          aria-label={`Next year for ${title}`}
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 text-center text-xs text-[#24272d]">
        {MONTH_LABELS.map((monthLabel, index) => {
          const value = `${year}-${String(index + 1).padStart(2, "0")}`;

          return (
            <button
              type="button"
              key={value}
              onClick={() => onSelect(value)}
              className={getMonthClassName(
                value,
                selectedMonth,
                rangeStart,
                rangeEnd
              )}
            >
              {monthLabel}
            </button>
          );
        })}
      </div>
    </section>
  );
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function getMonthClassName(
  month: string,
  selectedMonth: string,
  rangeStart: string,
  rangeEnd: string
) {
  const isSelected = month === selectedMonth;
  const isInRange =
    rangeStart &&
    rangeEnd &&
    month.localeCompare(rangeStart) > 0 &&
    month.localeCompare(rangeEnd) < 0;

  return [
    "flex h-7 items-center justify-center rounded-md transition",
    isSelected
      ? "bg-[#155fd1] font-semibold text-white"
      : isInRange
        ? "bg-[#edf4ff] text-[#155fd1]"
        : "hover:bg-[#f3f6fa]",
  ].join(" ");
}

function formatMonthLabel(value: string) {
  if (!value) return "";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function currentYear() {
  const today = new Date();

  return today.getFullYear();
}

function dateToMonthValue(value: string | null) {
  return value?.slice(0, 7) ?? "";
}

function monthValueToDate(value: string) {
  return `${value}-01`;
}

function monthValueToYear(value: string) {
  return value ? Number(value.slice(0, 4)) : currentYear();
}

function FilterSelect({
  disabled,
  label,
  name,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const buttonLabel = value || label;

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

  function openDropdown() {
    setDraftValue(value);
    setIsOpen((current) => !current);
  }

  function clearSelection() {
    setDraftValue("");
    setIsOpen(false);
    onChange("");
  }

  function closeWithoutApplying() {
    setDraftValue(value);
    setIsOpen(false);
  }

  function applySelection() {
    setIsOpen(false);
    onChange(draftValue);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        data-filter-name={name}
        onClick={openDropdown}
        className="dashboard-filter-button w-full"
        aria-expanded={isOpen}
        aria-label={label}
      >
        <span className="truncate">{buttonLabel}</span>
        <span className="text-[#667085]" aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className="dashboard-filter-menu absolute right-0 z-30 mt-2.5 w-full min-w-[16rem] p-3.5">
          <div className="dashboard-filter-title mb-2.5">{label}</div>
          <div className="max-h-64 overflow-auto pr-1">
            {options.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#d8dee7] px-3 py-8 text-center text-sm font-semibold text-[#667085]">
                No options available.
              </div>
            ) : (
              options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDraftValue(option)}
                  className="dashboard-filter-option w-full"
                >
                  <span
                    className={`dashboard-filter-checkbox ${
                      draftValue === option ? "checked-like" : ""
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{option}</span>
                </button>
              ))
            )}
          </div>

          <div className="dashboard-filter-footer mt-3">
            <button
              type="button"
              onClick={clearSelection}
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
              onClick={applySelection}
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

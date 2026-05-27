"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ReportMonthDefaultEditor,
  type ReportMonthDefaultConfig,
} from "../../_components/ReportMonthDefaultEditor";

type FilterOptions = {
  agents: string[];
  carriers: string[];
};

type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

type FilterValues = {
  agent: string[];
  carrier: string[];
  reportMonthRange: ReportMonthRange;
  messerStatement: string[];
  primaryMemberId: string;
};

type MultiFilterName = "agent" | "carrier";
type ClientFilterValues = Pick<FilterValues, "agent" | "carrier" | "primaryMemberId">;

export function HealthSalesHeaderFilters({
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
    <div className="flex flex-nowrap items-center justify-end gap-3 overflow-visible">
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

export function HealthSalesPerformanceFilters({
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
  const [memberId, setMemberId] = useState(filters.primaryMemberId);

  function replaceWithParams(params: URLSearchParams) {
    const query = params.toString();

    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }

  function updateMultiParam(name: MultiFilterName, values: string[]) {
    if (onClientFiltersChange) {
      onClientFiltersChange({
        agent: name === "agent" ? values : filters.agent,
        carrier: name === "carrier" ? values : filters.carrier,
        primaryMemberId: filters.primaryMemberId,
      });
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete(name);

    for (const value of values) {
      params.append(name, value);
    }

    replaceWithParams(params);
  }

  function updateParam(name: keyof FilterValues, value: string) {
    if (onClientFiltersChange && name === "primaryMemberId") {
      onClientFiltersChange({
        agent: filters.agent,
        carrier: filters.carrier,
        primaryMemberId: value,
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

  function applyMemberIdFilter() {
    updateParam("primaryMemberId", memberId.trim());
  }

  return (
    <div className="mb-8 flex flex-nowrap items-center justify-end gap-3 overflow-visible pb-1">
      <MultiSelectDropdown
        allLabel="All agents"
        disabled={isPending}
        label="Agent Name"
        options={options.agents}
        selectedValues={filters.agent}
        onApply={(values) => updateMultiParam("agent", values)}
      />
      <MultiSelectDropdown
        allLabel="All carriers"
        disabled={isPending}
        label="Carrier"
        options={options.carriers}
        selectedValues={filters.carrier}
        onApply={(values) => updateMultiParam("carrier", values)}
      />
      <label className="block w-[15rem] shrink-0">
        <span className="sr-only">Primary member id</span>
        <input
          aria-label="Primary member id"
          value={memberId}
          onBlur={applyMemberIdFilter}
          onChange={(event) => setMemberId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyMemberIdFilter();
            }
          }}
          placeholder="Primary member id"
          className="dashboard-filter-input"
          disabled={isPending}
          type="search"
        />
      </label>
    </div>
  );
}

function MultiSelectDropdown({
  allLabel,
  disabled,
  label,
  options,
  selectedValues,
  onApply,
}: {
  allLabel: string;
  disabled: boolean;
  label: string;
  options: string[];
  selectedValues: string[];
  onApply: (values: string[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draftSelected, setDraftSelected] = useState(selectedValues);
  const selectedSet = useMemo(() => new Set(draftSelected), [draftSelected]);
  const buttonLabel = useMemo(() => {
    if (selectedValues.length === 0) return allLabel;
    if (selectedValues.length === 1) return selectedValues[0];

    return `${selectedValues.length} selected`;
  }, [allLabel, selectedValues]);

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

  function toggleOption(option: string) {
    setDraftSelected((current) =>
      current.includes(option)
        ? current.filter((value) => value !== option)
        : [...current, option]
    );
  }

  function openDropdown() {
    setDraftSelected(selectedValues);
    setIsOpen((current) => !current);
  }

  function clearSelection() {
    setDraftSelected([]);
    setIsOpen(false);
    onApply([]);
  }

  function closeWithoutApplying() {
    setDraftSelected(selectedValues);
    setIsOpen(false);
  }

  function applySelection() {
    setIsOpen(false);
    onApply(draftSelected);
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={openDropdown}
        disabled={disabled}
        className="dashboard-filter-button w-[12.5rem]"
        aria-expanded={isOpen}
      >
        <span className="truncate">{buttonLabel}</span>
        <span className="text-[#667085]" aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className="dashboard-filter-menu absolute right-0 z-30 mt-2.5 w-[min(18rem,calc(100vw-1rem))] p-3.5">
          <div className="dashboard-filter-title mb-2.5">
            {label}
          </div>
          <div className="max-h-64 overflow-auto pr-1">
            {options.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#d8dee7] px-3 py-8 text-center text-sm font-semibold text-[#667085]">
                No options available.
              </div>
            ) : (
              options.map((option) => (
                <label
                  key={option}
                  className="dashboard-filter-option"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(option)}
                    onChange={() => toggleOption(option)}
                    className="dashboard-filter-checkbox"
                  />
                  <span className="truncate">{option}</span>
                </label>
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

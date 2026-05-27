"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReportMonthDefaultEditor,
  type ReportMonthDefaultConfig,
} from "../../_components/ReportMonthDefaultEditor";
import { useAgentHealthPerformanceFiltering } from "./AgentHealthPerformanceFilterState";

type AgentHealthReportMonthRangeFilterProps = {
  defaultConfig: ReportMonthDefaultConfig;
  startDate: string | null;
  endDate: string | null;
};

export function AgentHealthReportMonthRangeFilter({
  defaultConfig,
  startDate,
  endDate,
}: AgentHealthReportMonthRangeFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const beginFiltering = useAgentHealthPerformanceFiltering();
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
    if (!startDate && !endDate) return "All report months";
    if (startDate && endDate) {
      return `${formatMonthLabel(startDate)} - ${formatMonthLabel(endDate)}`;
    }

    if (startDate) return `From ${formatMonthLabel(startDate)}`;
    return `Through ${formatMonthLabel(endDate ?? "")}`;
  }, [startDate, endDate]);

  function closeWithoutApplying() {
    const nextStartMonth = dateToMonthValue(startDate);
    const nextEndMonth = dateToMonthValue(endDate);

    setDraftStartMonth(nextStartMonth);
    setDraftEndMonth(nextEndMonth);
    setStartYear(monthValueToYear(nextStartMonth || nextEndMonth));
    setEndYear(monthValueToYear(nextEndMonth || nextStartMonth));
    setIsOpen(false);
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

    const params = new URLSearchParams(searchParams.toString());

    if (nextStartMonth) {
      params.set("start", monthValueToDate(nextStartMonth));
    } else {
      params.delete("start");
    }

    if (nextEndMonth) {
      params.set("end", monthValueToDate(nextEndMonth));
    } else {
      params.delete("end");
    }

    if (nextStartMonth || nextEndMonth) {
      params.delete("reportMonthRange");
    } else {
      params.set("reportMonthRange", "all");
    }

    setIsOpen(false);
    const query = params.toString();
    pushFilterUrl(query);
  }

  function clearRange() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("start");
    params.delete("end");
    params.set("reportMonthRange", "all");
    setDraftStartMonth("");
    setDraftEndMonth("");
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="dashboard-filter-button min-w-[14.5rem]"
        aria-expanded={isOpen}
      >
        <span>{label}</span>
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

"use client";

import { FileDown, Filter } from "lucide-react";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { getHealthPaidPeriodLabel } from "@/lib/health-paid-period";

type PolicyInfoRow = {
  dealName: string;
  agentName: string;
  carrier: string;
  primaryMemberId: string;
  totalPaid: number;
  months: {
    hasRecord: boolean;
    paid: number;
    paidToDate: string | null;
    paidToDateRaw: string | null;
  }[];
};

type MonthStatusFilterValue = "unpaid" | "paid" | "no-record";
type FilterPanelKey =
  | "dealName"
  | "agentName"
  | "carrier"
  | "primaryMemberId"
  | `month-${number}`;
type SortDirection = "asc" | "desc";
type SortState = { key: FilterPanelKey; direction: SortDirection };
type FilterOption = { label: string; value: string };

const MONTH_STATUS_FILTER_OPTIONS: FilterOption[] = [
  { label: "Paid", value: "paid" },
  { label: "Unpaid", value: "unpaid" },
  { label: "No record", value: "no-record" },
];

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function HealthSalesPoliciesInformationTable({
  rows,
  visibleMonthCount,
}: {
  rows: PolicyInfoRow[];
  visibleMonthCount: number;
}) {
  const visibleMonthLabels = MONTH_LABELS.slice(0, visibleMonthCount);
  const tableWidth = 1136 + visibleMonthLabels.length * 136;

  const [dealNameFilterValues, setDealNameFilterValues] = useState<string[]>([]);
  const [agentFilterValues, setAgentFilterValues] = useState<string[]>([]);
  const [carrierFilterValues, setCarrierFilterValues] = useState<string[]>([]);
  const [memberIdFilterValues, setMemberIdFilterValues] = useState<string[]>([]);
  const [monthStatusFilters, setMonthStatusFilters] = useState<
    Record<string, MonthStatusFilterValue[]>
  >({});
  const [sortState, setSortState] = useState<SortState | null>(null);
  const [activeFilterPanel, setActiveFilterPanel] =
    useState<FilterPanelKey | null>(null);

  const dealNameOptions = useMemo(
    () => getUniqueSortedOptions(rows.map((row) => row.dealName)),
    [rows]
  );
  const agentOptions = useMemo(
    () => getUniqueSortedOptions(rows.map((row) => row.agentName)),
    [rows]
  );
  const carrierOptions = useMemo(
    () => getUniqueSortedOptions(rows.map((row) => row.carrier)),
    [rows]
  );
  const memberIdOptions = useMemo(
    () => getUniqueSortedOptions(rows.map((row) => row.primaryMemberId)),
    [rows]
  );

  const hasActiveFilters =
    dealNameFilterValues.length > 0 ||
    agentFilterValues.length > 0 ||
    carrierFilterValues.length > 0 ||
    memberIdFilterValues.length > 0 ||
    Object.keys(monthStatusFilters).length > 0 ||
    Boolean(sortState);

  const filteredRows = useMemo(() => {
    const activeMonthFilters = visibleMonthLabels
      .map((month, index) => ({ index, values: monthStatusFilters[month] ?? [] }))
      .filter((f) => f.values.length > 0);

    const nextRows = rows.filter((row) => {
      if (dealNameFilterValues.length > 0 && !dealNameFilterValues.includes(row.dealName))
        return false;
      if (agentFilterValues.length > 0 && !agentFilterValues.includes(row.agentName))
        return false;
      if (carrierFilterValues.length > 0 && !carrierFilterValues.includes(row.carrier))
        return false;
      if (memberIdFilterValues.length > 0 && !memberIdFilterValues.includes(row.primaryMemberId))
        return false;

      return activeMonthFilters.every(({ index, values }) =>
        matchesMonthStatusValues(row.months[index], values)
      );
    });

    if (sortState) {
      nextRows.sort((a, b) =>
        compareSortValues(
          getSortValue(a, sortState.key),
          getSortValue(b, sortState.key),
          sortState.direction
        )
      );
    }

    return nextRows;
  }, [
    agentFilterValues,
    carrierFilterValues,
    dealNameFilterValues,
    memberIdFilterValues,
    monthStatusFilters,
    rows,
    sortState,
    visibleMonthLabels,
  ]);

  useEffect(() => {
    if (!activeFilterPanel) return;

    function closeOnOutsideClick(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-policies-filter-root]")
      )
        return;
      setActiveFilterPanel(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveFilterPanel(null);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeFilterPanel]);

  function toggleFilterPanel(panel: FilterPanelKey) {
    setActiveFilterPanel((current) => (current === panel ? null : panel));
  }

  function updateMonthStatusFilter(month: string, values: MonthStatusFilterValue[]) {
    setMonthStatusFilters((current) => {
      const next = { ...current };
      if (values.length === 0 || values.length === MONTH_STATUS_FILTER_OPTIONS.length) {
        delete next[month];
      } else {
        next[month] = values;
      }
      return next;
    });
  }

  function updateSort(key: FilterPanelKey, direction: SortDirection) {
    setSortState({ key, direction });
    setActiveFilterPanel(null);
  }

  function clearAllFilters() {
    setDealNameFilterValues([]);
    setAgentFilterValues([]);
    setCarrierFilterValues([]);
    setMemberIdFilterValues([]);
    setMonthStatusFilters({});
    setSortState(null);
    setActiveFilterPanel(null);
  }

  function exportFilteredRows() {
    const headers = buildExportHeaders(visibleMonthLabels);
    const exportRows = filteredRows.map((row, index) => [
      index + 1,
      row.dealName,
      row.agentName,
      row.carrier,
      row.primaryMemberId,
      row.totalPaid,
      ...row.months
        .slice(0, visibleMonthLabels.length)
        .flatMap((month) => [
          getMonthExportStatus(month),
          month.hasRecord ? month.paid : "",
          getPaidToDateDisplay(month),
        ]),
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...exportRows]);
    sheet["!cols"] = headers.map((header) => ({
      wch: getExportColumnWidth(header),
    }));
    applyExportCurrencyFormat(sheet, exportRows.length, visibleMonthLabels.length);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Policies");
    XLSX.writeFile(
      workbook,
      `policies-information-${new Date().toISOString().slice(0, 10)}.xlsx`,
      { compression: true }
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-[0_2px_8px_rgba(22,35,58,0.08)]">
      <header className="border-b border-[#edf0f4] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#16233a]">
              Policies Information
            </h2>
            <p className="mt-1 text-xs text-[#667085]">
              Showing {formatInteger(filteredRows.length)} of{" "}
              {formatInteger(rows.length)} rows
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clearAllFilters}
              disabled={!hasActiveFilters}
              className="inline-flex h-10 items-center rounded-md border border-[#cfd7e3] bg-white px-3 text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear Filters
            </button>
            <button
              type="button"
              onClick={exportFilteredRows}
              disabled={filteredRows.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[#cfd7e3] bg-white px-3 text-sm font-semibold text-[#184e8a] transition hover:bg-[#f3f6fa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileDown aria-hidden="true" size={16} strokeWidth={2.2} />
              Export XLSX
            </button>
          </div>
        </div>
      </header>
      <div className="max-h-[720px] overflow-auto">
        <table
          className="text-sm"
          style={{ width: tableWidth, minWidth: tableWidth }}
        >
          <thead>
            <tr className="border-b border-[#edf0f4] text-left text-xs font-semibold uppercase tracking-wide text-[#667085]">
              <th className="sticky left-0 top-0 z-20 w-12 border-r border-[#edf0f4] bg-white px-3 py-3 text-right">
                #
              </th>
              <th className="sticky left-12 top-0 z-30 w-[30rem] border-r border-[#edf0f4] bg-white px-4 py-3">
                <FilterableHeader
                  active={
                    dealNameFilterValues.length > 0 ||
                    sortState?.key === "dealName"
                  }
                  isOpen={activeFilterPanel === "dealName"}
                  label="Deal Name"
                  onToggle={() => toggleFilterPanel("dealName")}
                >
                  <ExcelFilterPanel
                    label="Deal Name"
                    onApply={setDealNameFilterValues}
                    onCancel={() => setActiveFilterPanel(null)}
                    onClearFilter={() => setDealNameFilterValues([])}
                    onSort={(direction) => updateSort("dealName", direction)}
                    options={dealNameOptions}
                    selectedValues={dealNameFilterValues}
                  />
                </FilterableHeader>
              </th>
              <th className="sticky top-0 z-20 w-40 border-r border-[#edf0f4] bg-white px-3 py-3">
                <FilterableHeader
                  active={
                    agentFilterValues.length > 0 ||
                    sortState?.key === "agentName"
                  }
                  isOpen={activeFilterPanel === "agentName"}
                  label="Agent"
                  onToggle={() => toggleFilterPanel("agentName")}
                >
                  <ExcelFilterPanel
                    label="Agent"
                    onApply={setAgentFilterValues}
                    onCancel={() => setActiveFilterPanel(null)}
                    onClearFilter={() => setAgentFilterValues([])}
                    onSort={(direction) => updateSort("agentName", direction)}
                    options={agentOptions}
                    selectedValues={agentFilterValues}
                  />
                </FilterableHeader>
              </th>
              <th className="sticky top-0 z-20 w-28 border-r border-[#edf0f4] bg-white px-3 py-3">
                <FilterableHeader
                  active={
                    carrierFilterValues.length > 0 ||
                    sortState?.key === "carrier"
                  }
                  isOpen={activeFilterPanel === "carrier"}
                  label="Carrier"
                  onToggle={() => toggleFilterPanel("carrier")}
                >
                  <ExcelFilterPanel
                    label="Carrier"
                    onApply={setCarrierFilterValues}
                    onCancel={() => setActiveFilterPanel(null)}
                    onClearFilter={() => setCarrierFilterValues([])}
                    onSort={(direction) => updateSort("carrier", direction)}
                    options={carrierOptions}
                    selectedValues={carrierFilterValues}
                  />
                </FilterableHeader>
              </th>
              <th className="sticky top-0 z-20 w-56 border-r border-[#edf0f4] bg-white px-4 py-3">
                <FilterableHeader
                  active={
                    memberIdFilterValues.length > 0 ||
                    sortState?.key === "primaryMemberId"
                  }
                  isOpen={activeFilterPanel === "primaryMemberId"}
                  label="Primary Member ID"
                  onToggle={() => toggleFilterPanel("primaryMemberId")}
                >
                  <ExcelFilterPanel
                    label="Primary Member ID"
                    onApply={setMemberIdFilterValues}
                    onCancel={() => setActiveFilterPanel(null)}
                    onClearFilter={() => setMemberIdFilterValues([])}
                    onSort={(direction) =>
                      updateSort("primaryMemberId", direction)
                    }
                    options={memberIdOptions}
                    selectedValues={memberIdFilterValues}
                  />
                </FilterableHeader>
              </th>
              <th className="sticky top-0 z-10 w-28 border-r border-[#edf0f4] bg-white px-3 py-3 text-right">
                Total Paid
              </th>
              {visibleMonthLabels.map((month, monthIndex) => (
                <th
                  key={month}
                  className="sticky top-0 z-20 w-28 border-r border-[#edf0f4] bg-white px-3 py-3 text-right last:border-r-0"
                >
                  <FilterableHeader
                    active={
                      Boolean(monthStatusFilters[month]?.length) ||
                      sortState?.key === getMonthFilterPanelKey(monthIndex)
                    }
                    align="right"
                    isOpen={
                      activeFilterPanel === getMonthFilterPanelKey(monthIndex)
                    }
                    label={month}
                    onToggle={() =>
                      toggleFilterPanel(getMonthFilterPanelKey(monthIndex))
                    }
                  >
                    <ExcelFilterPanel
                      label={month}
                      onApply={(values) =>
                        updateMonthStatusFilter(
                          month,
                          values as MonthStatusFilterValue[]
                        )
                      }
                      onCancel={() => setActiveFilterPanel(null)}
                      onClearFilter={() => updateMonthStatusFilter(month, [])}
                      onSort={(direction) =>
                        updateSort(getMonthFilterPanelKey(monthIndex), direction)
                      }
                      options={MONTH_STATUS_FILTER_OPTIONS}
                      selectedValues={monthStatusFilters[month] ?? []}
                      sortAscLabel="Sort smallest to largest"
                      sortDescLabel="Sort largest to smallest"
                    />
                  </FilterableHeader>
                </th>
              ))}
            </tr>
          </thead>
          <PoliciesTableBody
            monthStatusFilters={monthStatusFilters}
            visibleMonthLabels={visibleMonthLabels}
            rows={filteredRows}
          />
        </table>
      </div>
    </section>
  );
}

const PoliciesTableBody = memo(function PoliciesTableBody({
  monthStatusFilters,
  visibleMonthLabels,
  rows,
}: {
  monthStatusFilters: Record<string, MonthStatusFilterValue[]>;
  visibleMonthLabels: string[];
  rows: PolicyInfoRow[];
}) {
  return (
    <tbody>
      {rows.length === 0 ? (
        <tr>
          <td
            className="px-6 py-10 text-center text-[#667085]"
            colSpan={6 + visibleMonthLabels.length}
          >
            No policies matched these filters.
          </td>
        </tr>
      ) : (
        rows.map((row, index) => (
          <tr
            key={`${row.dealName}-${row.agentName}-${row.carrier}-${row.primaryMemberId}`}
            className="border-b border-[#f1f3f7] last:border-b-0"
          >
            <td className="sticky left-0 z-10 border-r border-[#edf0f4] bg-white px-3 py-2.5 text-right font-semibold text-[#667085]">
              {index + 1}
            </td>
            <td className="sticky left-12 z-10 border-r border-[#edf0f4] bg-white px-4 py-2.5 font-semibold leading-5 text-[#16233a]">
              {row.dealName}
            </td>
            <td className="border-r border-[#edf0f4] px-3 py-2.5 text-[#344054]">
              {row.agentName}
            </td>
            <td className="border-r border-[#edf0f4] px-3 py-2.5 text-[#344054]">
              {row.carrier}
            </td>
            <td className="border-r border-[#edf0f4] px-4 py-2.5 text-[#344054]">
              {row.primaryMemberId}
            </td>
            <td className="border-r border-[#edf0f4] px-3 py-2.5 text-right font-semibold text-[#16233a]">
              {formatCurrency(row.totalPaid)}
            </td>
            {row.months
              .slice(0, visibleMonthLabels.length)
              .map((month, monthIndex) => {
                const monthLabel = visibleMonthLabels[monthIndex];
                const activeMonthStatusFilters =
                  monthStatusFilters[monthLabel] ?? [];
                const isFocusedUnpaid =
                  activeMonthStatusFilters.includes("unpaid") &&
                  getMonthCellFilterValue(month) === "unpaid";

                return (
                  <td
                    key={`${row.primaryMemberId}-${MONTH_LABELS[monthIndex]}`}
                    className={`border-r px-3 py-2.5 text-right last:border-r-0 ${
                      isFocusedUnpaid
                        ? "border-[#f5c6d0] bg-[#fff1f3]"
                        : "border-[#edf0f4]"
                    }`}
                  >
                    <MonthPaymentCell month={month} />
                  </td>
                );
              })}
          </tr>
        ))
      )}
    </tbody>
  );
});

function FilterableHeader({
  active,
  align = "left",
  children,
  isOpen,
  label,
  onToggle,
}: {
  active: boolean;
  align?: "left" | "right";
  children: ReactNode;
  isOpen: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div className="relative" data-policies-filter-root>
      <div
        className={`flex items-center gap-2 ${
          align === "right" ? "justify-end" : "justify-between"
        }`}
      >
        <span>{label}</span>
        <button
          type="button"
          onClick={onToggle}
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#667085] transition hover:bg-[#e9eef6] hover:text-[#184e8a] ${
            active ? "bg-[#dbeafe] text-[#184e8a]" : ""
          }`}
          aria-label={`Filter ${label}`}
          aria-pressed={active}
        >
          <Filter aria-hidden="true" size={14} strokeWidth={2.4} />
        </button>
      </div>
      {isOpen ? (
        <div
          className={`absolute top-full z-50 mt-2 w-72 rounded-lg border border-[#cfd7e3] bg-white p-3 text-left text-sm normal-case tracking-normal text-[#16233a] shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ExcelFilterPanel({
  label,
  onApply,
  onCancel,
  onClearFilter,
  onSort,
  options,
  selectedValues,
  sortAscLabel = "Sort A to Z",
  sortDescLabel = "Sort Z to A",
}: {
  label: string;
  onApply: (values: string[]) => void;
  onCancel: () => void;
  onClearFilter: () => void;
  onSort: (direction: SortDirection) => void;
  options: FilterOption[];
  selectedValues: string[];
  sortAscLabel?: string;
  sortDescLabel?: string;
}) {
  const optionValues = useMemo(
    () => options.map((option) => option.value),
    [options]
  );
  const [searchValue, setSearchValue] = useState("");
  const [draftValues, setDraftValues] = useState<string[]>(
    selectedValues.length > 0 ? selectedValues : optionValues
  );
  const draftValueSet = useMemo(() => new Set(draftValues), [draftValues]);
  const visibleOptions = useMemo(() => {
    const search = searchValue.trim().toLowerCase();
    if (!search) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(search)
    );
  }, [options, searchValue]);
  const selectedVisibleCount = visibleOptions.reduce(
    (count, option) => count + (draftValueSet.has(option.value) ? 1 : 0),
    0
  );
  const areAllVisibleSelected =
    visibleOptions.length > 0 &&
    selectedVisibleCount === visibleOptions.length;

  function toggleDraftValue(value: string) {
    setDraftValues((current) => {
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return [...next];
    });
  }

  function selectAllValues() {
    setDraftValues(optionValues);
  }

  function clearFilter() {
    setDraftValues(optionValues);
    onClearFilter();
    onCancel();
  }

  function toggleVisibleValues() {
    const visibleValues = visibleOptions.map((option) => option.value);
    const visibleValueSet = new Set(visibleValues);
    setDraftValues((current) => {
      if (areAllVisibleSelected) {
        return current.filter((value) => !visibleValueSet.has(value));
      }
      return [...new Set([...current, ...visibleValues])];
    });
  }

  function applyFilter() {
    onApply(
      draftValues.length === optionValues.length
        ? []
        : sortSelectedValues(draftValues)
    );
    onCancel();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1 border-b border-[#edf0f4] pb-2">
        <button
          type="button"
          onClick={() => onSort("asc")}
          className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]"
        >
          {sortAscLabel}
        </button>
        <button
          type="button"
          onClick={() => onSort("desc")}
          className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]"
        >
          {sortDescLabel}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={selectAllValues}
          className="font-semibold text-[#184e8a] hover:underline"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={clearFilter}
          className="font-semibold text-[#184e8a] hover:underline"
        >
          Clear filter
        </button>
        <span className="ml-auto text-[#667085]">
          Displaying {formatInteger(visibleOptions.length)}
        </span>
      </div>
      <label className="block">
        <span className="sr-only">Search {label}</span>
        <input
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Search values"
          className="h-9 w-full rounded-md border border-[#cfd7e3] bg-white px-3 text-sm font-normal text-[#16233a] outline-none transition focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/10"
          type="search"
        />
      </label>
      <div className="max-h-44 overflow-auto border-y border-[#edf0f4] py-1">
        {visibleOptions.length === 0 ? (
          <div className="px-2 py-3 text-sm text-[#667085]">
            No values found.
          </div>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]">
              <input
                type="checkbox"
                checked={areAllVisibleSelected}
                onChange={toggleVisibleValues}
                className="h-4 w-4 rounded border-[#cfd7e3] text-[#184e8a] focus:ring-[#184e8a]"
              />
              <span>(Select visible)</span>
            </label>
            {visibleOptions.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]"
              >
                <input
                  type="checkbox"
                  checked={draftValueSet.has(option.value)}
                  onChange={() => toggleDraftValue(option.value)}
                  className="h-4 w-4 rounded border-[#cfd7e3] text-[#184e8a] focus:ring-[#184e8a]"
                />
                <span className="truncate" title={option.label}>
                  {option.label}
                </span>
              </label>
            ))}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-md border border-[#cfd7e3] bg-white px-4 text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={applyFilter}
          disabled={draftValues.length === 0}
          className="h-9 rounded-md bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#166534] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
        >
          OK
        </button>
      </div>
    </div>
  );
}

function MonthPaymentCell({
  month,
}: {
  month: PolicyInfoRow["months"][number];
}) {
  if (!month.hasRecord) {
    return <span className="text-[#98a2b3]">-</span>;
  }

  if (!month.paidToDate) {
    return (
      <>
        <div className="font-semibold text-[#c01048]">Unpaid</div>
        <div className="mt-1 text-xs text-[#98a2b3]">
          {formatCurrency(month.paid)}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="font-semibold text-[#16233a]">
        {formatCurrency(month.paid)}
      </div>
      <div className="mt-1 whitespace-nowrap text-xs text-[#667085]">
        {getPaidToDateDisplay(month)}
      </div>
    </>
  );
}

function matchesMonthStatusValues(
  month: PolicyInfoRow["months"][number] | undefined,
  values: MonthStatusFilterValue[]
) {
  if (values.length === 0) return true;
  return values.includes(getMonthCellFilterValue(month));
}

function getMonthCellFilterValue(
  month: PolicyInfoRow["months"][number] | undefined
): MonthStatusFilterValue {
  if (!month?.hasRecord) return "no-record";
  return month.paidToDate ? "paid" : "unpaid";
}

function getSortValue(row: PolicyInfoRow, key: FilterPanelKey) {
  if (key === "dealName") return row.dealName;
  if (key === "agentName") return row.agentName;
  if (key === "carrier") return row.carrier;
  if (key === "primaryMemberId") return row.primaryMemberId;

  const monthIndex = Number(key.replace("month-", ""));
  const month = Number.isInteger(monthIndex) ? row.months[monthIndex] : null;
  return month?.hasRecord ? month.paid : -1;
}

function compareSortValues(
  leftValue: string | number,
  rightValue: string | number,
  direction: SortDirection
) {
  const multiplier = direction === "asc" ? 1 : -1;
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * multiplier;
  }
  return String(leftValue).localeCompare(String(rightValue)) * multiplier;
}

function sortSelectedValues(values: string[]) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function getUniqueSortedOptions(values: string[]): FilterOption[] {
  return [...new Set(values)]
    .sort((a, b) => getFilterOptionLabel(a).localeCompare(getFilterOptionLabel(b)))
    .map((value) => ({ label: getFilterOptionLabel(value), value }));
}

function getFilterOptionLabel(value: string) {
  return value || "(Blanks)";
}

function getMonthFilterPanelKey(index: number): FilterPanelKey {
  return `month-${index}` as FilterPanelKey;
}

function buildExportHeaders(monthLabels: string[]) {
  return [
    "#",
    "Deal Name",
    "Agent",
    "Carrier",
    "Primary Member ID",
    "Total Paid",
    ...monthLabels.flatMap((month) => [
      `${month} Status`,
      `${month} Paid`,
      `${month} Paid To Date`,
    ]),
  ];
}

function getMonthExportStatus(month: PolicyInfoRow["months"][number]) {
  if (!month.hasRecord) return "No Record";
  return month.paidToDate ? "Paid" : "Unpaid";
}

function getPaidToDateDisplay(month: PolicyInfoRow["months"][number]) {
  if (!month.paidToDate) return "";

  return getHealthPaidPeriodLabel(month.paidToDateRaw) ?? formatDate(month.paidToDate);
}

function getExportColumnWidth(header: string) {
  if (header === "#") return 8;
  if (header === "Deal Name") return 36;
  if (header === "Agent") return 20;
  if (header === "Primary Member ID") return 24;
  if (header.endsWith("Paid To Date")) return 22;
  if (header.endsWith("Status")) return 16;
  return 14;
}

function applyExportCurrencyFormat(
  sheet: XLSX.WorkSheet,
  rowCount: number,
  monthCount: number
) {
  const currencyColumnIndexes = [
    5,
    ...Array.from({ length: monthCount }, (_, index) => 7 + index * 3),
  ];

  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    for (const columnIndex of currencyColumnIndexes) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[cellAddress];
      if (cell && cell.t === "n") {
        cell.z = "$#,##0.00";
      }
    }
  }
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

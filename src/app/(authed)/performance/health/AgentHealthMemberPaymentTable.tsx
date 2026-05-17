"use client";

import { useMemo, useState } from "react";

type MemberPaymentRow = {
  dealName: string;
  carrier: string;
  primaryMemberId: string;
  totalPaid: number;
  months: {
    hasRecord: boolean;
    paid: number;
    paidToDate: string | null;
  }[];
};

type PaymentStatusFilter = "all" | "unpaid" | "paid";

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function AgentHealthMemberPaymentTable({
  rows,
  visibleMonthCount,
}: {
  rows: MemberPaymentRow[];
  visibleMonthCount: number;
}) {
  const [memberIdFilter, setMemberIdFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<PaymentStatusFilter>("all");
  const [monthFilter, setMonthFilter] = useState("latest");
  const visibleMonthLabels = MONTH_LABELS.slice(0, visibleMonthCount);
  const tableWidth = 976 + visibleMonthLabels.length * 112;
  const selectedMonthIndex = getSelectedMonthIndex(
    monthFilter,
    visibleMonthCount
  );
  const filteredRows = useMemo(() => {
    const filter = memberIdFilter.trim().toLowerCase();

    return rows.filter((row) => {
      if (filter && !row.primaryMemberId.toLowerCase().includes(filter)) {
        return false;
      }

      if (statusFilter === "all") return true;

      const visibleMonths = row.months.slice(0, visibleMonthCount);
      if (selectedMonthIndex === null) {
        return visibleMonths.some((month) =>
          matchesPaymentStatus(month, statusFilter)
        );
      }

      return matchesPaymentStatus(
        visibleMonths[selectedMonthIndex],
        statusFilter
      );
    });
  }, [
    memberIdFilter,
    rows,
    selectedMonthIndex,
    statusFilter,
    visibleMonthCount,
  ]);

  return (
    <section className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-[0_2px_8px_rgba(22,35,58,0.08)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#edf0f4] px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-[#16233a]">
            Member Payment History | Current Report Year
          </h2>
          <p className="mt-1 text-xs text-[#667085]">
            Showing {formatInteger(filteredRows.length)} of {formatInteger(rows.length)} rows
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-3">
          <label className="flex min-w-[10rem] flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-[#667085]">
            Month
            <select
              value={monthFilter}
              onChange={(event) => setMonthFilter(event.target.value)}
              className="h-10 rounded-md border border-[#cfd7e3] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[#16233a] outline-none transition focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/10"
            >
              <option value="latest">Latest month</option>
              <option value="any">Any month</option>
              {visibleMonthLabels.map((month, index) => (
                <option key={month} value={String(index)}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-[#667085]">
            Payment Status
            <div className="inline-flex h-10 overflow-hidden rounded-md border border-[#cfd7e3] bg-white">
              {(["all", "unpaid", "paid"] as PaymentStatusFilter[]).map(
                (status) => {
                  const isActive = statusFilter === status;

                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatusFilter(status)}
                      className={`px-3 text-sm font-semibold normal-case tracking-normal transition ${
                        isActive
                          ? "bg-[#184e8a] text-white"
                          : "text-[#344054] hover:bg-[#f3f6fa]"
                      }`}
                      aria-pressed={isActive}
                    >
                      {getStatusFilterLabel(status)}
                    </button>
                  );
                }
              )}
            </div>
          </div>
          <label className="flex min-w-[280px] flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-[#667085]">
            Primary Member ID
            <input
              value={memberIdFilter}
              onChange={(event) => setMemberIdFilter(event.target.value)}
              placeholder="Filter member id..."
              className="h-10 rounded-md border border-[#cfd7e3] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#16233a] outline-none transition focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/10"
              type="search"
            />
          </label>
        </div>
      </header>
      <div className="max-h-[720px] overflow-auto">
        <table className="text-sm" style={{ width: tableWidth, minWidth: tableWidth }}>
          <thead>
            <tr className="border-b border-[#edf0f4] text-left text-xs font-semibold uppercase tracking-wide text-[#667085]">
              <th className="sticky left-0 top-0 z-20 w-12 border-r border-[#edf0f4] bg-white px-3 py-3 text-right">
                #
              </th>
              <th className="sticky left-12 top-0 z-20 w-[30rem] border-r border-[#edf0f4] bg-white px-4 py-3">
                Deal Name
              </th>
              <th className="sticky top-0 z-10 w-28 border-r border-[#edf0f4] bg-white px-3 py-3">
                Carrier
              </th>
              <th className="sticky top-0 z-10 w-56 border-r border-[#edf0f4] bg-white px-4 py-3">
                Primary Member ID
              </th>
              <th className="sticky top-0 z-10 w-28 border-r border-[#edf0f4] bg-white px-3 py-3 text-right">
                Total Paid
              </th>
              {visibleMonthLabels.map((month) => (
                <th
                  key={month}
                  className="sticky top-0 z-10 w-28 border-r border-[#edf0f4] bg-white px-3 py-3 text-right last:border-r-0"
                >
                  {month}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  className="px-6 py-10 text-center text-[#667085]"
                  colSpan={5 + visibleMonthLabels.length}
                >
                  No policies matched these filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => (
                <tr
                  key={`${row.dealName}-${row.carrier}-${row.primaryMemberId}`}
                  className="border-b border-[#f1f3f7] last:border-b-0"
                >
                  <td className="sticky left-0 z-10 border-r border-[#edf0f4] bg-white px-3 py-2.5 text-right font-semibold text-[#667085]">
                    {index + 1}
                  </td>
                  <td className="sticky left-12 z-10 border-r border-[#edf0f4] bg-white px-4 py-2.5 font-semibold leading-5 text-[#16233a]">
                    {row.dealName}
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
                      const isFocusedUnpaid =
                        statusFilter === "unpaid" &&
                        matchesSelectedMonth(monthIndex, selectedMonthIndex) &&
                        matchesPaymentStatus(month, "unpaid");

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
        </table>
      </div>
    </section>
  );
}

function MonthPaymentCell({
  month,
}: {
  month: MemberPaymentRow["months"][number];
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
      <div className="mt-1 text-xs text-[#667085]">
        {formatDate(month.paidToDate)}
      </div>
    </>
  );
}

function getSelectedMonthIndex(monthFilter: string, visibleMonthCount: number) {
  if (monthFilter === "any" || visibleMonthCount === 0) return null;
  if (monthFilter === "latest") return visibleMonthCount - 1;

  const parsed = Number(monthFilter);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= visibleMonthCount) {
    return visibleMonthCount - 1;
  }

  return parsed;
}

function matchesSelectedMonth(
  monthIndex: number,
  selectedMonthIndex: number | null
) {
  return selectedMonthIndex === null || selectedMonthIndex === monthIndex;
}

function matchesPaymentStatus(
  month: MemberPaymentRow["months"][number] | undefined,
  status: Exclude<PaymentStatusFilter, "all">
) {
  if (!month?.hasRecord) return false;
  const isPaid = Boolean(month.paidToDate);

  return status === "paid" ? isPaid : !isPaid;
}

function getStatusFilterLabel(status: PaymentStatusFilter) {
  if (status === "paid") return "Paid";
  if (status === "unpaid") return "Unpaid";
  return "All";
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

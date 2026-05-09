"use client";

import { useMemo, useState } from "react";

type MemberPaymentRow = {
  dealName: string;
  carrier: string;
  primaryMemberId: string;
  totalPaid: number;
  months: {
    paid: number;
    paidToDate: string | null;
  }[];
};

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

export function MemberPaymentTable({ rows }: { rows: MemberPaymentRow[] }) {
  const [memberIdFilter, setMemberIdFilter] = useState("");
  const filteredRows = useMemo(() => {
    const filter = memberIdFilter.trim().toLowerCase();

    if (!filter) return rows;

    return rows.filter((row) =>
      row.primaryMemberId.toLowerCase().includes(filter)
    );
  }, [memberIdFilter, rows]);

  return (
    <section className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-[0_2px_8px_rgba(22,35,58,0.08)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#edf0f4] px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-[#16233a]">
            Member Payment Detail | Current Report Year
          </h2>
          <p className="mt-1 text-xs text-[#667085]">
            Showing {formatInteger(filteredRows.length)} of {formatInteger(rows.length)} rows
          </p>
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
      </header>
      <div className="max-h-[720px] overflow-auto">
        <table className="min-w-[2200px] text-sm">
          <thead>
            <tr className="border-b border-[#edf0f4] text-left text-xs font-semibold uppercase tracking-wide text-[#667085]">
              <th className="sticky left-0 top-0 z-20 w-16 bg-white px-5 py-4 text-right">
                #
              </th>
              <th className="sticky left-16 top-0 z-20 w-64 bg-white px-5 py-4">
                Deal Name
              </th>
              <th className="sticky top-0 z-10 w-40 bg-white px-4 py-4">
                Carrier
              </th>
              <th className="sticky top-0 z-10 w-44 bg-white px-4 py-4">
                Primary Member ID
              </th>
              <th className="sticky top-0 z-10 w-32 bg-white px-4 py-4 text-right">
                Total Paid
              </th>
              {MONTH_LABELS.map((month) => (
                <th
                  key={month}
                  className="sticky top-0 z-10 w-40 bg-white px-4 py-4 text-right"
                >
                  {month}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td className="px-6 py-10 text-center text-[#667085]" colSpan={17}>
                  No payment detail matched this member ID.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => (
                <tr
                  key={`${row.dealName}-${row.carrier}-${row.primaryMemberId}`}
                  className="border-b border-[#f1f3f7] last:border-b-0"
                >
                  <td className="sticky left-0 z-10 bg-white px-5 py-4 text-right font-semibold text-[#667085]">
                    {index + 1}
                  </td>
                  <td className="sticky left-16 z-10 bg-white px-5 py-4 font-semibold text-[#16233a]">
                    {row.dealName}
                  </td>
                  <td className="px-4 py-4 text-[#344054]">{row.carrier}</td>
                  <td className="px-4 py-4 text-[#344054]">
                    {row.primaryMemberId}
                  </td>
                  <td className="px-4 py-4 text-right font-semibold text-[#16233a]">
                    {formatCurrency(row.totalPaid)}
                  </td>
                  {row.months.map((month, monthIndex) => (
                    <td
                      key={`${row.primaryMemberId}-${MONTH_LABELS[monthIndex]}`}
                      className="px-4 py-4 text-right"
                    >
                      <div className="font-semibold text-[#16233a]">
                        {formatCurrency(month.paid)}
                      </div>
                      <div className="mt-1 text-xs text-[#667085]">
                        {month.paidToDate
                          ? formatDate(month.paidToDate)
                          : "No paid date"}
                      </div>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
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

"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import type { PortalAccount } from "@/lib/accounting/health/source";
import { formatDate, MONTHS, paidDates, parseMoney, type HealthCommissionRow } from "@/lib/accounting/health/values";
import { CellValue } from "./ui";

/** One deal through the months of its year. */
export function DealDrawer({
  rows,
  linkedAccount,
  onClose,
}: {
  rows: HealthCommissionRow[];
  linkedAccount: (agent: string) => PortalAccount | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (rows.length === 0) return null;
  const last = rows.reduce((latest, row) => (row.m > latest.m ? row : latest));
  const byMonth = new Map(rows.map((row) => [row.m, row]));
  const account = linkedAccount(last.agent);
  // Paid Thru = the last Paid-to-date of a month the agent was paid (same rule as the table).
  const paidThru = rows
    .filter((row) => parseMoney(row.ar) !== null)
    .flatMap((row) => paidDates(row.ptd))
    .reduce<Date | null>((latest, date) => (!latest || date > latest ? date : latest), null);
  const facts: Array<[string, string]> = [
    ["Carrier", last.carrier],
    ["Plan", last.plan],
    ["Member ID", last.mid],
    ["State", last.state],
    ["Num Client", last.n],
    ["Plan Eff", last.pe],
    ["Broker Eff", last.be],
    ["Paid Thru", formatDate(paidThru)],
    ["Stage", last.stage],
    ["Pay rate", last.rate],
    ["Portal account", account ? `${account.name}${account.agentId ? ` · ${account.agentId}` : ""}` : "Not linked"],
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#091e42]/25" onClick={onClose} />
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[760px] flex-col bg-white shadow-[-12px_0_32px_rgba(9,30,66,0.2)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">
              {last.y} · {last.agent}
            </div>
            <h2 className="mt-1 text-xl font-semibold text-[#172b4d]">{last.deal}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
            {facts.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">{label}</dt>
                <dd className="mt-0.5 break-words text-sm font-semibold text-[#172b4d]">{value || "—"}</dd>
              </div>
            ))}
          </dl>
          <table className="mt-5 w-full text-sm">
            <thead>
              <tr className="border-b border-[#dfe1e6] text-left text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
                <th className="py-2 pr-2">Month</th>
                <th className="px-2 py-2 text-right">Messer Paid</th>
                <th className="px-2 py-2 text-right">Agent Received</th>
                <th className="px-2 py-2 text-right">Override Recv</th>
                <th className="px-2 py-2 text-right">EPS Split</th>
                <th className="px-2 py-2">Paid to date</th>
                <th className="py-2 pl-2">Statement</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((label, index) => {
                const row = byMonth.get(index + 1);
                return (
                  <tr key={label} className="border-b border-[#ebecf0]">
                    <td className="py-2 pr-2 font-semibold">{label}</td>
                    {row ? (
                      <>
                        <td className="px-2 py-2 text-right"><CellValue field="mp" value={row.mp} /></td>
                        <td className="px-2 py-2 text-right"><CellValue field="ar" value={row.ar} /></td>
                        <td className="px-2 py-2 text-right"><CellValue field="ovr" value={row.ovr} /></td>
                        <td className="px-2 py-2 text-right"><CellValue field="sp" value={row.sp} /></td>
                        <td className="px-2 py-2"><CellValue field="ptd" value={row.ptd} /></td>
                        <td className="py-2 pl-2"><CellValue field="st" value={row.st} /></td>
                      </>
                    ) : (
                      <td colSpan={6} className="px-2 py-2 text-[#c1c7d0]">—</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </aside>
    </>
  );
}

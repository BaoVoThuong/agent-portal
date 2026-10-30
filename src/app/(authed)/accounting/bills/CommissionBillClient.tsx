"use client";

import { useMemo, useState } from "react";
import { Download, FileText, Search } from "lucide-react";
import * as XLSX from "xlsx";
import {
  PAGE_ACTIONS_CLASS,
  PAGE_HEADER_CLASS,
  PAGE_PRIMARY_BUTTON_CLASS,
  PAGE_TITLE_CLASS,
  pageSecondaryButtonClass,
} from "../../_shared/page-header-styles";
import { buildBill, type Bill, type BillHeader } from "@/lib/accounting/health/bill";
import { defaultAgentLinks } from "@/lib/accounting/health/links";
import type { PortalAccount } from "@/lib/accounting/health/source";
import {
  dealKeys,
  formatMoney,
  monthKey,
  monthKeyLabel,
  MONTHS,
  parseMoney,
  unpackRows,
  type PackedHealthRows,
} from "@/lib/accounting/health/values";
import { CellValue, TASK_FILTER_BUTTON_CLASS, TASK_SEARCH_INPUT_CLASS, ToggleGroup, UnlinkedDot } from "../_components/ui";
import { TaskSelect } from "../../tasks/_components/TaskSelect";

const LEFT_FIELDS: Array<[keyof BillHeader | null, string]> = [
  [null, "Cycle:"],
  ["transactionDate", "Transaction Date:"],
  [null, "Agent Name:"],
  ["payee", "Payee:"],
  ["statementNo", "Statement No."],
  ["payRate", "Pay Rate Level"],
  [null, "ID Founder"],
];
const RIGHT_FIELDS: Array<[keyof BillHeader | null, string]> = [
  ["balance", "Balance from Previous Statement"],
  [null, "Total Payout"],
  ["checkNo", "Check #"],
  ["totalMembers", "Total Members"],
  ["paidMembers", "Paid Members"],
  ["unpaidMembers", "Unpaid Members"],
  ["noContract", "No Contract"],
  ["terminated", "Terminated"],
  ["unpaidPremium", "UP"],
];

// Only the bill prints: the sidebar, top bar and agent list are hidden.
const PRINT_CSS = `@media print {
  @page { size: landscape; margin: 8mm; }
  body * { visibility: hidden; }
  .bill-print, .bill-print * { visibility: visible; }
  .bill-print { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; padding: 0 !important; }
  .bill-print .bill-scroll { overflow: visible !important; }
  .bill-print input { background: transparent !important; border-color: transparent !important; }
  .bill-print table { font-size: 9px; }
}`;

export function CommissionBillClient({ packed, accounts }: { packed: PackedHealthRows; accounts: PortalAccount[] }) {
  const rows = useMemo(() => unpackRows(packed), [packed]);
  const keys = useMemo(() => dealKeys(rows), [rows]);
  const links = useMemo(() => defaultAgentLinks(new Set(rows.map((row) => row.agent)), accounts), [rows, accounts]);
  const cycles = useMemo(() => [...new Set(rows.map((row) => monthKey(row.y, row.m)))].sort((a, b) => b - a), [rows]);
  const [cycle, setCycle] = useState(cycles[0] ?? 0);
  const [pickedAgent, setAgent] = useState("");
  const [search, setSearch] = useState("");
  const [asAgent, setAsAgent] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Partial<BillHeader>>>({});

  const payouts = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      if (monthKey(row.y, row.m) !== cycle) continue;
      totals.set(row.agent, (totals.get(row.agent) ?? 0) + (parseMoney(row.ar) ?? 0));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows, cycle]);
  // Until someone is picked, show the agent with the largest payout this cycle.
  const agent = pickedAgent || payouts[0]?.[0] || "";

  const year = Math.floor(cycle / 100);
  const month = cycle % 100;
  const bill = useMemo(() => buildBill(rows, keys, agent, year, month), [rows, keys, agent, year, month]);
  const overrideKey = `${agent}|${cycle}`;
  const header: BillHeader = { ...bill.suggested, ...overrides[overrideKey] };
  const account = accounts.find((item) => item.id === links[agent]) ?? null;
  const setField = (field: keyof BillHeader, value: string) =>
    setOverrides((current) => ({ ...current, [overrideKey]: { ...current[overrideKey], [field]: value } }));

  const fixedValue = (label: string) =>
    label === "Cycle:" ? bill.cycle : label === "Agent Name:" ? agent : label === "ID Founder" ? account?.agentId ?? "" : formatMoney(bill.payout);

  const q = search.trim().toUpperCase();

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7f9fc] text-[#172b4d]">
      <style>{PRINT_CSS}</style>
      <div className="min-w-0 shrink-0 px-6 pb-4 pt-5">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3">
        <header className={PAGE_HEADER_CLASS}>
          <div>
            <h1 className={PAGE_TITLE_CLASS}>Commission Bill</h1>
          </div>
          <div className={PAGE_ACTIONS_CLASS}>
            <button type="button" className={pageSecondaryButtonClass()} onClick={() => exportBill(bill, header, account?.agentId ?? "")}>
              <Download className="h-4 w-4" /> Download Excel
            </button>
            <button type="button" className={PAGE_PRIMARY_BUTTON_CLASS} onClick={() => window.print()}>
              <FileText className="h-4 w-4" /> Download PDF
            </button>
          </div>
        </header>
        <section className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <TaskSelect
            value={String(cycle)}
            options={cycles.map((key) => ({ value: String(key), label: monthKeyLabel(key) }))}
            placeholder="Cycle"
            className="w-max min-w-[8.75rem]"
            buttonClassName={TASK_FILTER_BUTTON_CLASS}
            onChange={(value) => setCycle(Number(value))}
          />
          <ToggleGroup
            options={[
              { value: "accountant", label: "Accountant view" },
              { value: "agent", label: "Agent view" },
            ]}
            value={asAgent ? "agent" : "accountant"}
            onChange={(value) => setAsAgent(value === "agent")}
          />
          <span className="ml-auto shrink-0 text-sm font-medium text-[#626f86]">
            {agent} · {bill.lines.length} deals · Payout {formatMoney(bill.payout)}
          </span>
        </section>
        </div>
      </div>

      <div className={`grid min-h-0 flex-1 gap-4 px-6 pb-6 ${asAgent ? "grid-cols-1" : "grid-cols-[280px_minmax(0,1fr)]"}`}>
        {asAgent ? null : (
          <aside className="flex min-h-0 flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
            <div className="shrink-0 border-b border-[#dfe1e6] p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search agent" className={TASK_SEARCH_INPUT_CLASS} />
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {payouts
                .filter(([name]) => !q || name.toUpperCase().includes(q))
                .map(([name, total]) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => setAgent(name)}
                      className={`flex w-full items-center gap-2 rounded-md border-2 px-2.5 py-2 text-left transition ${
                        name === agent ? "border-[#0c66e4] bg-[#f5f9ff]" : "border-transparent hover:bg-[#f7f8f9]"
                      }`}
                    >
                      {links[name] ? null : <UnlinkedDot />}
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
                      <span className="text-[13px] tabular-nums text-[#44546f]">{formatMoney(total)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </aside>
        )}

        <section className="min-h-0 overflow-auto rounded border border-[#dfe1e6] bg-[#eef0f3] p-5">
          <div className="bill-print mx-auto min-w-[900px] bg-white px-8 py-7 shadow-[0_1px_3px_rgba(9,30,66,0.15)]">
            <h2 className="mb-5 text-center text-xl font-bold tracking-[0.06em]">AGENT COMMISSION STATEMENT</h2>
            <div className="mb-3 grid grid-cols-2 gap-12">
              {[LEFT_FIELDS, RIGHT_FIELDS].map((fields, side) => (
                <div key={side}>
                  {fields.map(([field, label]) => (
                    <div key={label} className="grid min-h-[30px] grid-cols-[190px_minmax(0,1fr)] items-center border-b border-[#ebecf0]">
                      <span className="text-sm font-semibold text-[#44546f]">{label}</span>
                      {field ? (
                        <input
                          value={header[field]}
                          readOnly={asAgent}
                          onChange={(event) => setField(field, event.target.value)}
                          className={`h-[26px] w-full rounded-sm border border-transparent px-1.5 text-sm font-semibold focus:border-[#0c66e4] focus:bg-white focus:outline-none ${
                            side ? "text-right" : ""
                          } ${asAgent ? "bg-transparent" : "bg-[#fffbeb] hover:border-[#dfe1e6]"}`}
                        />
                      ) : (
                        <span
                          className={`px-1.5 text-sm font-semibold ${side ? "text-right" : ""} ${
                            label === "Total Payout" ? "text-base text-[#0c66e4]" : ""
                          }`}
                        >
                          {fixedValue(label)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t-2 border-[#172b4d] pb-3 pt-2 text-xs text-[#44546f]">
              {[["P", "Pending"], ["NC", "No Commission"], ["P2", "Paid in Feb Statement · P3: Paid in Mar Statement…"], ["C", "Chargeback"], ["N/C", "No contract"], ["T", "Terminated"], ["UP", "Unpaid Premium"]].map(([code, text]) => (
                <span key={code}>
                  <b className="text-[#172b4d]">{code}</b> : {text}
                </span>
              ))}
            </div>
            <div className="bill-scroll overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <caption className="py-1.5 text-left text-[13px] font-bold">Commission Details</caption>
                <thead>
                  <tr className="bg-[#13284a] text-left text-white">
                    {["Number of members", "Deal Name", "Carrier", "Plan name", "ID", "Broker Effective"].map((label) => (
                      <th key={label} className="whitespace-nowrap px-1.5 py-1.5 font-semibold">{label}</th>
                    ))}
                    {MONTHS.slice(0, month).map((label) => (
                      <th key={label} className="whitespace-nowrap px-1.5 py-1.5 text-right font-semibold">{label}</th>
                    ))}
                    <th className="whitespace-nowrap px-1.5 py-1.5 text-right font-semibold">Paid to date</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.lines.map((line) => (
                    <tr key={line.key} className="border-b border-[#ebecf0] even:bg-[#fafbfc]">
                      <td className="px-1.5 py-1">{line.last.n}</td>
                      <td className="max-w-[320px] truncate whitespace-nowrap px-1.5 py-1" title={line.last.deal}>{line.last.deal}</td>
                      <td className="whitespace-nowrap px-1.5 py-1">{line.last.carrier}</td>
                      <td className="max-w-[220px] truncate whitespace-nowrap px-1.5 py-1" title={line.last.plan}>{line.last.plan}</td>
                      <td className="whitespace-nowrap px-1.5 py-1">{line.last.mid}</td>
                      <td className="whitespace-nowrap px-1.5 py-1">{line.last.pe || line.last.be}</td>
                      {MONTHS.slice(0, month).map((label, index) => (
                        <td key={label} className="whitespace-nowrap px-1.5 py-1 text-right">
                          <CellValue field="ar" value={line.months[index + 1]?.ar} />
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-1.5 py-1 text-right font-bold tabular-nums">{formatMoney(line.paidToDate)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#172b4d] font-bold">
                    <td colSpan={6 + month} className="px-1.5 py-1.5">{bill.lines.length} deals</td>
                    <td className="px-1.5 py-1.5 text-right tabular-nums">{formatMoney(bill.lines.reduce((sum, line) => sum + line.paidToDate, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function exportBill(bill: Bill, header: BillHeader, agentId: string) {
  const width = 6 + bill.month + 1;
  const blank = () => Array<string>(width).fill("");
  const line = (left: string, leftValue: string, right?: string, rightValue?: string) => {
    const row = blank();
    row[0] = left;
    row[2] = leftValue;
    if (right) {
      row[6] = right;
      row[width - 1] = rightValue ?? "";
    }
    return row;
  };
  const title = blank();
  title[3] = "AGENT COMMISSION STATEMENT";
  const months = MONTHS.slice(0, bill.month);
  const table = [
    blank(),
    title,
    blank(),
    line("Cycle:", bill.cycle),
    line("Transaction Date:", header.transactionDate, "Balance from Previous Statement", header.balance),
    line("Agent Name:", bill.agent, "Total Payout", formatMoney(bill.payout)),
    line("Payee:", header.payee, "Check #", header.checkNo),
    line("Statement No.", header.statementNo, "Total Members", header.totalMembers),
    line("Pay Rate Level", header.payRate, "Paid Members", header.paidMembers),
    line("ID Founder", agentId, "Unpaid Members", header.unpaidMembers),
    line("", "", "No Contract", header.noContract),
    line("", "", "Terminated", header.terminated),
    line("", "", "UP", header.unpaidPremium),
    ["P : Pending", "NC: No Commission", "P2: Paid in Feb Statement / P3: Paid in Mar Statement", "C: Chargeback", "N/C : No contract", "T : Terminated", "UP: Unpaid Premium"],
    ["Commission Details"],
    ["Number of members", "Deal Name", "Carrier", "Plan name", "ID", "Broker Effective", ...months, "Paid to date"],
    ...bill.lines.map((deal) => [
      deal.last.n, deal.last.deal, deal.last.carrier, deal.last.plan, deal.last.mid, deal.last.pe || deal.last.be,
      ...months.map((_, index) => deal.months[index + 1]?.ar ?? ""),
      formatMoney(deal.paidToDate),
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(table);
  sheet["!cols"] = [{ wch: 10 }, { wch: 48 }, { wch: 12 }, { wch: 34 }, { wch: 18 }, { wch: 12 }, ...months.map(() => ({ wch: 10 })), { wch: 12 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Bill");
  XLSX.writeFile(book, `Bill_${bill.agent.replace(/\s+/g, "_")}_${MONTHS[bill.month - 1]}_${bill.year}.xlsx`);
}

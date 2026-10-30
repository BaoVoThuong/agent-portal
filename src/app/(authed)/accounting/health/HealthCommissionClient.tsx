"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, ChevronRight, Download, Search, Settings2, Upload, UsersRound } from "lucide-react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import {
  PAGE_ACTIONS_CLASS,
  PAGE_HEADER_CLASS,
  PAGE_PRIMARY_BUTTON_CLASS,
  PAGE_TITLE_CLASS,
  pageSecondaryButtonClass,
} from "../../_shared/page-header-styles";
import { AMOUNT_FIELDS, groupDeals, unpaidMonths, type DealLine } from "@/lib/accounting/health/deals";
import { displayValue } from "@/lib/accounting/health/display";
import { defaultAgentLinks, type AgentLinks } from "@/lib/accounting/health/links";
import type { PortalAccount } from "@/lib/accounting/health/source";
import {
  COMMISSION_STATUSES,
  commissionStatus,
  dealKeys,
  formatDate,
  paidDates,
  formatMoney,
  MONTHS,
  parseCount,
  parseMoney,
  ROW_FIELDS,
  unpackRows,
  type CommissionStatus,
  type HealthCommissionRow,
  type PackedHealthRows,
  type RowField,
} from "@/lib/accounting/health/values";
import {
  AgentName,
  CellValue,
  CodeBand,
  TASK_FILTER_BUTTON_CLASS,
  TASK_SEARCH_INPUT_CLASS,
  TABLE_FRAME_CLASS,
} from "../_components/ui";
import { TaskSelect } from "../../tasks/_components/TaskSelect";
import { useAnchoredMenu } from "../../tasks/_components/use-anchored-menu";
import { AgentLinksDialog } from "../_components/AgentLinksDialog";
import { DealDrawer } from "../_components/DealDrawer";
import { UploadMonthDialog, type ImportedMonth } from "../_components/UploadMonthDialog";

const ROW_HEIGHT = 44;
const STATUS_LABELS: Record<CommissionStatus, string> = {
  Paid: "Paid",
  P: "P · Pending",
  "P2–P8": "P2–P8 · Paid later",
  NC: "NC · No commission",
  "N/C": "N/C · No contract",
  T: "T · Terminated",
  UP: "UP · Unpaid premium",
  C: "C · Chargeback",
  NE: "NE",
  Blank: "Blank",
  Other: "Other",
};

type Column<T> = {
  key: string;
  label: string;
  width: number;
  align?: "right";
  pinned?: boolean;
  sortValue?: (item: T) => string | number;
  render: (item: T) => ReactNode;
  /** The row and field a double-click edits. */
  editTarget?: (item: T) => { row: HealthCommissionRow; field: RowField } | null;
  /** Header group above the column (a month, "Total"); `groupMonth` makes it open that month. */
  group?: string;
  groupMonth?: number;
  /** First column of its group: draws the divider. */
  groupStart?: boolean;
  /** Sticky total row under the table, like the sheet's total line. */
  footer?: (items: T[]) => ReactNode;
  /** Two-line cell (amount + small note): less vertical padding. */
  dense?: boolean;
  /** Table settings entry that shows / hides this column (one entry for a field in every month). */
  toggle?: { key: string; label: string };
  /**
   * The whole group as one cell for this item — a month with only a code (NC,
   * T, P6…) or no row at all — instead of the same code in every column.
   */
  merged?: (item: T) => { code: string | null; edit: { row: HealthCommissionRow; field: RowField } | null } | null;
};

type ColumnContext<T> = {
  accountOf: (agent: string) => PortalAccount | null;
  onOpen: (item: T) => void;
};

/**
 * Paid Thru (column K of the yearly sheet) is not typed by hand any more: it is
 * the deal's last commission payment — the latest Paid-to-date among the months
 * where the agent received money (user's call, 2026-10-28; the typed column was
 * never kept up, half empty).
 */
function paidThruColumn<T>(lastPaid: (item: T) => Date | null): Column<T> {
  return {
    key: "pt",
    label: FIELD_COLUMNS.pt.label,
    width: FIELD_COLUMNS.pt.width,
    toggle: { key: "pt", label: FIELD_COLUMNS.pt.label },
    sortValue: (item) => lastPaid(item)?.getTime() ?? 0,
    render: (item) => <CellValue field="pt" value={formatDate(lastPaid(item))} />,
  };
}

/** Months between Broker Effective and now that no payment covers (see unpaidMonths), in red. */
function unpaidColumn<T>(unpaidOf: (item: T) => readonly number[]): Column<T> {
  const label = (key: number) => `${MONTHS[(key % 100) - 1]}${Math.floor(key / 100) === new Date().getFullYear() ? "" : ` '${String(Math.floor(key / 100)).slice(2)}`}`;
  return {
    key: "unpaid",
    label: "Unpaid",
    width: 150,
    toggle: { key: "unpaid", label: "Unpaid" },
    sortValue: (item) => unpaidOf(item).length,
    render: (item) => {
      const months = unpaidOf(item);
      if (months.length === 0) return <CellValue field="pt" value="" />;
      const text = months.map(label).join(", ");
      return (
        <span className="truncate text-xs font-semibold text-[#ae2e24]" title={`Not paid: ${text}`}>
          {text}
        </span>
      );
    },
  };
}

const sumMoney = <T,>(items: readonly T[], value: (item: T) => string | number | undefined) => (
  <span className="text-[13px] font-semibold tabular-nums text-[#172b4d]">
    {formatMoney(items.reduce((sum, item) => {
      const raw = value(item);
      return sum + (typeof raw === "number" ? raw : parseMoney(raw) ?? 0);
    }, 0))}
  </span>
);

type Sort = { key: string; dir: "asc" | "desc" } | null;
type Edits = Map<number, Partial<Record<RowField, string>>>;

const YEAR_COLUMN_WIDTH = 64;
const MONEY_FIELDS = new Set<RowField>(["mp", "ar", "ov", "ovr", "sp"]);
/** Every row field's column: header label and width, wide enough for the label. */
const FIELD_COLUMNS: Record<Exclude<RowField, "deal" | "agent">, { label: string; width: number }> = {
  n: { label: "Num Client", width: 112 },
  stage: { label: "Deal stage", width: 120 },
  state: { label: "State", width: 72 },
  carrier: { label: "Carrier", width: 112 },
  plan: { label: "Plan name", width: 220 },
  mid: { label: "Primary ID", width: 150 },
  pe: { label: "Plan Eff", width: 108 },
  be: { label: "Broker Eff", width: 112 },
  pt: { label: "Paid Thru", width: 108 },
  mp: { label: "Messer Paid", width: 116 },
  rate: { label: "Rate", width: 72 },
  ar: { label: "Agent Recv", width: 112 },
  ov: { label: "Override", width: 104 },
  ovr: { label: "Ovr Recv", width: 104 },
  sp: { label: "Split", width: 96 },
  ptd: { label: "Paid To", width: 112 },
  tid: { label: "Trans ID", width: 112 },
  st: { label: "Statement", width: 108 },
};
const INFO_FIELDS = ["n", "stage", "state", "carrier", "plan", "mid", "pe", "be", "pt"] as const;
/** The month block of the yearly sheet ("Current 2026 deals"), in its column order. */
const MONTH_BLOCK = ["mp", "rate", "ar", "ov", "ovr", "sp", "ptd", "tid", "st"] as const;
/** A collapsed month shows only what the carrier paid; ▸ opens the whole block. */
const MONTH_BLOCK_COLLAPSED = ["mp"] as const;

const yearCell = (year: number) => <span className="truncate font-mono text-xs font-bold text-[#97a0af]">{year}</span>;

/** Like the Task list's title cell: the name is the button that opens the record. */
function dealNameCell(name: string, onOpen: () => void) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      title={name}
      className="w-full min-w-0 truncate rounded px-1.5 py-1 text-left text-sm font-medium text-[#172b4d] transition hover:bg-[#f4f5f7] hover:text-[#0c66e4]"
    >
      <span className="block truncate">{name}</span>
    </button>
  );
}

/** Messer Paid, with the period it pays up to in small type underneath: "07/31/26". */
function messerPaidCell(row: HealthCommissionRow | undefined) {
  const amount = <CellValue field="mp" value={row?.mp} />;
  if (!row || parseMoney(row.mp) === null) return amount;
  const thru = paidDates(row.ptd).reduce<Date | null>((latest, date) => (!latest || date > latest ? date : latest), null);
  if (!thru) return amount;
  const label = `${String(thru.getMonth() + 1).padStart(2, "0")}/${String(thru.getDate()).padStart(2, "0")}/${String(thru.getFullYear()).slice(2)}`;
  return (
    <span className="flex flex-col items-end leading-tight" title={`Paid to ${formatDate(thru)}`}>
      {amount}
      <span className="text-[10px] font-medium text-[#8590a2]">{label}</span>
    </span>
  );
}

function fieldColumn<T>(
  field: Exclude<RowField, "deal" | "agent">,
  key: string,
  rowOf: (item: T) => HealthCommissionRow | undefined,
  extra: Partial<Column<T>> = {},
): Column<T> {
  const money = MONEY_FIELDS.has(field);
  return {
    key,
    label: FIELD_COLUMNS[field].label,
    width: FIELD_COLUMNS[field].width,
    align: money || field === "n" ? "right" : undefined,
    toggle: { key: field, label: FIELD_COLUMNS[field].label },
    editTarget: (item) => {
      const row = rowOf(item);
      return row ? { row, field } : null;
    },
    sortValue: (item) => (money ? parseMoney(rowOf(item)?.[field]) ?? -1e12 : field === "n" ? parseCount(rowOf(item)?.n) : rowOf(item)?.[field] ?? ""),
    render: (item) =>
      field === "mp" ? messerPaidCell(rowOf(item)) : <CellValue field={field} value={rowOf(item)?.[field]} />,
    dense: field === "mp",
    footer: money ? (items) => sumMoney(items, (item) => rowOf(item)?.[field]) : undefined,
    ...extra,
  };
}

function monthColumns(
  { accountOf, onOpen }: ColumnContext<HealthCommissionRow>,
  lastPaidOf: (row: HealthCommissionRow) => Date | null,
  unpaidOf: (row: HealthCommissionRow) => readonly number[],
): Column<HealthCommissionRow>[] {
  const self = (row: HealthCommissionRow) => row;
  return [
    { key: "year", label: "Year", width: YEAR_COLUMN_WIDTH, pinned: true, sortValue: (row) => row.y * 100 + row.m, render: (row) => yearCell(row.y) },
    {
      key: "deal", label: "Deal name", width: 300, pinned: true,
      editTarget: (row) => ({ row, field: "deal" }), sortValue: (row) => row.deal, render: (row) => dealNameCell(row.deal, () => onOpen(row)),
    },
    { key: "month", label: "Month", width: 80, sortValue: (row) => row.m, render: (row) => <span className="text-xs font-semibold text-[#42526e]">{MONTHS[row.m - 1]}</span> },
    {
      key: "agent", label: "Agent", width: 180, toggle: { key: "agent", label: "Agent" },
      editTarget: (row) => ({ row, field: "agent" }), sortValue: (row) => row.agent, render: (row) => <AgentName name={row.agent} account={accountOf(row.agent)} />,
    },
    ...INFO_FIELDS.flatMap((field) =>
      field === "pt" ? [paidThruColumn(lastPaidOf), unpaidColumn(unpaidOf)] : [fieldColumn(field, field, self)],
    ),
    ...MONTH_BLOCK.map((field) => fieldColumn(field, field, self)),
  ];
}

function dealColumns(
  months: number[],
  expanded: ReadonlySet<number>,
  { accountOf, onOpen }: ColumnContext<DealLine>,
  unpaidOf: (deal: DealLine) => readonly number[],
): Column<DealLine>[] {
  const latest = (deal: DealLine) => deal.last;
  const columns: Column<DealLine>[] = [
    { key: "year", label: "Year", width: YEAR_COLUMN_WIDTH, pinned: true, sortValue: (d) => d.y, render: (d) => yearCell(d.y) },
    { key: "deal", label: "Deal name", width: 240, pinned: true, sortValue: (d) => d.last.deal, render: (d) => dealNameCell(d.last.deal, () => onOpen(d)) },
    // Deal facts come from the latest month; edit them in a month's view.
    // Stage stays pinned beside the name: it matters in every month.
    { ...fieldColumn("stage", "stage", latest), width: 110, pinned: true, editTarget: undefined },
    {
      key: "agent", label: "Team", width: 180, toggle: { key: "agent", label: "Team" },
      sortValue: (d) => d.last.agent, render: (d) => <AgentName name={d.last.agent} account={accountOf(d.last.agent)} />,
    },
    ...INFO_FIELDS.filter((field) => field !== "stage").flatMap((field) =>
      field === "pt"
        ? [paidThruColumn<DealLine>((d) => d.lastPaid), unpaidColumn(unpaidOf)]
        : [{ ...fieldColumn(field, field, latest), editTarget: undefined }],
    ),
  ];
  AMOUNT_FIELDS.forEach((field, index) =>
    columns.push({
      key: `total-${field}`,
      label: FIELD_COLUMNS[field].label,
      width: 120,
      align: "right",
      group: "Total",
      groupStart: index === 0,
      toggle: { key: "total", label: "Totals" },
      sortValue: (d) => d.totals[field],
      render: (d) => (
        <span className={`text-[13px] font-semibold tabular-nums ${d.totals[field] === 0 ? "text-[#97a0af]" : "text-[#172b4d]"}`}>
          {formatMoney(d.totals[field])}
        </span>
      ),
      footer: (deals) => sumMoney(deals, (d) => d.totals[field]),
    }),
  );
  months.forEach((month) => {
    const merged = (d: DealLine) => {
      const row = d.months[month];
      if (!row) return { code: null, edit: null };
      return displayValue("ar", row.ar).kind === "code" ? { code: row.ar, edit: { row, field: "ar" as const } } : null;
    };
    (expanded.has(month) ? MONTH_BLOCK : MONTH_BLOCK_COLLAPSED).forEach((field, index) =>
      columns.push(
        fieldColumn(field, `m${month}-${field}`, (d: DealLine) => d.months[month], {
          group: MONTHS[month - 1],
          groupMonth: month,
          groupStart: index === 0,
          merged,
        }),
      ),
    );
  });
  return columns;
}

const inYears = (picked: readonly string[], year: number) => picked.length === 0 || picked.includes(String(year));

function sortItems<T>(items: T[], columns: Column<T>[], sort: Sort): T[] {
  const column = sort && columns.find((c) => c.key === sort.key);
  if (!column?.sortValue) return items;
  const dir = sort!.dir === "asc" ? 1 : -1;
  const value = column.sortValue;
  return [...items].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
}

export function HealthCommissionClient({
  packed,
  fetchedAt,
  accounts,
}: {
  packed: PackedHealthRows;
  fetchedAt: number;
  accounts: PortalAccount[];
}) {
  const [rows, setRows] = useState(() => unpackRows(packed));
  const [edits, setEdits] = useState<Edits>(() => new Map());
  const agentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.agent, (counts.get(row.agent) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const [links, setLinks] = useState<AgentLinks>(() => defaultAgentLinks(new Set(rows.map((row) => row.agent)), accounts));
  const years = useMemo(() => [...new Set(rows.map((row) => row.y))].sort(), [rows]);
  // Like Enrollment's Year filter: pick any years; none picked = all years.
  const [yearFilter, setYearFilter] = useState<string[]>(() => (years.length ? [String(years[years.length - 1])] : []));
  const [month, setMonth] = useState(0);
  const [agent, setAgent] = useState<string[]>([]);
  const [carrier, setCarrier] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"upload" | "agents" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(() => new Set());
  const [unpaidOnly, setUnpaidOnly] = useState(false);

  const keys = useMemo(() => dealKeys(rows), [rows]);
  const carriers = useMemo(() => [...new Set(rows.map((row) => row.carrier.toUpperCase()).filter(Boolean))].sort(), [rows]);
  const monthsInYear = useMemo(
    () => [...new Set(rows.filter((row) => inYears(yearFilter, row.y)).map((row) => row.m))].sort((a, b) => a - b),
    [rows, yearFilter],
  );

  const baseRows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return rows.filter(
      (row) =>
        inYears(yearFilter, row.y) &&
        (agent.length === 0 || agent.includes(row.agent)) &&
        (carrier.length === 0 || carrier.includes(row.carrier.toUpperCase())) &&
        (!q || row.deal.toUpperCase().includes(q) || row.mid.toUpperCase().includes(q) || row.tid.toUpperCase().includes(q)),
    );
  }, [rows, yearFilter, agent, carrier, query]);

  const accountOf = useMemo(() => {
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return (name: string) => byId.get(links[name] ?? "") ?? null;
  }, [accounts, links]);
  const visible = <T,>(columns: Column<T>[]) => {
    const shown = columns.filter((column) => !column.toggle || !hidden.has(column.toggle.key));
    // A hidden first column must not take its group's divider with it.
    return shown.map((column, index) => ({
      ...column,
      groupStart: Boolean(column.group) && (index === 0 || shown[index - 1].group !== column.group || shown[index - 1].groupMonth !== column.groupMonth),
    }));
  };

  // Per deal, across its whole year: Paid Thru and the months still unpaid.
  const latestReport = useMemo(() => rows.reduce((max, row) => Math.max(max, row.y * 100 + row.m), 0), [rows]);
  const dealFacts = useMemo(
    () =>
      new Map(
        groupDeals(rows, keys).map((deal) => [deal.key, { lastPaid: deal.lastPaid, unpaid: unpaidMonths(deal, latestReport) }]),
      ),
    [rows, keys, latestReport],
  );
  const NONE: readonly number[] = [];
  const unpaidOfKey = (key: string) => dealFacts.get(key)?.unpaid ?? NONE;

  const monthView = useMemo(() => {
    if (!month) return null;
    const list = baseRows
      .filter((row) => row.m === month && (status.length === 0 || status.includes(commissionStatus(row.ar))))
      .filter((row) => !unpaidOnly || unpaidOfKey(keys.get(row.id) ?? "").length > 0)
      .sort((a, b) => b.y - a.y || a.id - b.id);
    const all = monthColumns(
      { accountOf, onOpen: (row) => setDrawerKey(keys.get(row.id) ?? null) },
      (row) => dealFacts.get(keys.get(row.id) ?? "")?.lastPaid ?? null,
      (row) => unpaidOfKey(keys.get(row.id) ?? ""),
    );
    const columns = visible(all);
    return { all, columns, items: sortItems(list, columns, sort) };
    // `visible` only reads `hidden`, which is a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRows, month, status, unpaidOnly, accountOf, sort, keys, hidden, dealFacts]);

  const dealView = useMemo(() => {
    if (month) return null;
    let list = groupDeals(baseRows, keys);
    if (status.length) list = list.filter((deal) => Object.values(deal.months).some((row) => row && status.includes(commissionStatus(row.ar))));
    if (unpaidOnly) list = list.filter((deal) => unpaidOfKey(deal.key).length > 0);
    list.sort((a, b) => b.y - a.y || a.firstRowId - b.firstRowId);
    const all = dealColumns(monthsInYear, expandedMonths, { accountOf, onOpen: (deal) => setDrawerKey(deal.key) }, (deal) => unpaidOfKey(deal.key));
    const columns = visible(all);
    return { all, columns, items: sortItems(list, columns, sort) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRows, month, keys, status, unpaidOnly, monthsInYear, expandedMonths, accountOf, sort, hidden, dealFacts]);

  const shown = monthView ? monthView.items : dealView!.items;
  const members = monthView
    ? monthView.items.reduce((sum, row) => sum + parseCount(row.n), 0)
    : dealView!.items.reduce((sum, deal) => sum + parseCount(deal.last.n), 0);
  const summary = `${shown.length.toLocaleString()} ${monthView ? "rows" : "deals"} · ${members.toLocaleString()} members`;

  const editCount = [...edits.values()].reduce((sum, fields) => sum + Object.keys(fields).length, 0);

  const commitEdit = (rowId: number, field: RowField, value: string) => {
    const row = rows.find((item) => item.id === rowId);
    if (!row || row[field] === value) return;
    setEdits((current) => {
      const next = new Map(current);
      const fields = { ...(next.get(rowId) ?? {}) };
      if (fields[field] === undefined) fields[field] = row[field];
      if (fields[field] === value) delete fields[field];
      if (Object.keys(fields).length) next.set(rowId, fields);
      else next.delete(rowId);
      return next;
    });
    setRows((current) => current.map((item) => (item.id === rowId ? { ...item, [field]: value } : item)));
  };

  const discardEdits = () => {
    setRows((current) => current.map((row) => (edits.has(row.id) ? { ...row, ...edits.get(row.id) } : row)));
    setEdits(new Map());
  };

  const importMonth = ({ year: y, month: m, rows: incoming }: ImportedMonth) => {
    setRows((current) => {
      let nextId = current.reduce((max, row) => Math.max(max, row.id), 0);
      const kept = current.filter((row) => !(row.y === y && row.m === m));
      return [...kept, ...incoming.map((row) => ({ ...row, id: ++nextId, y, m }))];
    });
    setEdits(new Map());
    setYearFilter([String(y)]);
    setMonth(m);
    setDialog(null);
    setNotice(`${MONTHS[m - 1]} ${y}: ${incoming.length.toLocaleString()} rows imported — not saved, UI preview only`);
  };

  const exportView = () => {
    const header = ["agent", "number_cus", "deal_name", "stage", "state", "carrier", "plan_name", "primary_member_id", "plan_effective_date", "broker_effective_date", "paid_thru_date", "carriers_messer_paid", "pay_rate_level", "agent_received", "eps_override", "eps_override_received", "eps_split", "paid_to_date", "transaction_id", "statement", "month_report"];
    const list = monthView ? monthView.items : baseRows;
    const sheet = XLSX.utils.aoa_to_sheet([header, ...list.map((row) => [...ROW_FIELDS.map((f) => row[f]), `${String(row.m).padStart(2, "0")}-${row.y}`])]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Health Commission");
    XLSX.writeFile(book, `Health_Commission_${yearFilter.join("-") || "all"}${month ? `_${MONTHS[month - 1]}` : ""}.xlsx`);
  };

  const filtersOn = Boolean(agent.length || carrier.length || status.length || query || unpaidOnly);

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7f9fc] text-[#172b4d]">
      <div className="min-w-0 shrink-0 px-6 pb-4 pt-5">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3">
          <header className={PAGE_HEADER_CLASS}>
            <div>
              <h1 className={PAGE_TITLE_CLASS}>Health Commission</h1>
            </div>
            <div className={PAGE_ACTIONS_CLASS}>
              <button type="button" className={pageSecondaryButtonClass()} onClick={exportView}>
                <Download className="h-4 w-4" /> Export
              </button>
              <button type="button" className={pageSecondaryButtonClass()} onClick={() => setDialog("agents")}>
                <UsersRound className="h-4 w-4" /> Agents
              </button>
              <button type="button" className={PAGE_PRIMARY_BUTTON_CLASS} onClick={() => setDialog("upload")}>
                <Upload className="h-4 w-4" /> Upload month
              </button>
            </div>
          </header>

          <section className="mt-2 min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                <div className="relative min-w-[18rem] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#44546f]" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search deal, member ID, transaction ID"
                    className={TASK_SEARCH_INPUT_CLASS}
                  />
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <TaskSelect
                label="Year"
                multi
                values={yearFilter}
                options={[{ value: "", label: "All Years" }, ...years.map((y) => ({ value: String(y), label: String(y) }))]}
                placeholder="Year"
                allValue=""
                summaryLabel="years"
                className="w-max min-w-[7.25rem]"
                buttonClassName={TASK_FILTER_BUTTON_CLASS}
                onValuesChange={(values) => {
                  setYearFilter(values);
                  setMonth(0);
                  setSort(null);
                }}
              />
              <TaskSelect
                value={String(month)}
                options={[
                  { value: "0", label: "All months" },
                  ...MONTHS.map((label, index) => ({ value: String(index + 1), label, disabled: !monthsInYear.includes(index + 1) })),
                ]}
                placeholder="Month"
                className="w-max min-w-[8.75rem]"
                buttonClassName={TASK_FILTER_BUTTON_CLASS}
                onChange={(value) => {
                  setMonth(Number(value));
                  setSort(null);
                }}
              />
              <TaskSelect
                multi
                searchable
                values={agent}
                options={agentCounts.map(([name]) => ({ value: name, label: name }))}
                placeholder="Agent"
                allValue=""
                summaryLabel="agents"
                className="w-max min-w-[9rem]"
                buttonClassName={TASK_FILTER_BUTTON_CLASS}
                onValuesChange={setAgent}
              />
              <TaskSelect
                multi
                searchable
                values={carrier}
                options={carriers.map((name) => ({ value: name, label: name }))}
                placeholder="Carrier"
                allValue=""
                summaryLabel="carriers"
                className="w-max min-w-[9rem]"
                buttonClassName={TASK_FILTER_BUTTON_CLASS}
                onValuesChange={setCarrier}
              />
              <TaskSelect
                multi
                values={status}
                options={COMMISSION_STATUSES.map((name) => ({ value: name, label: STATUS_LABELS[name] }))}
                placeholder="Status"
                allValue=""
                summaryLabel="statuses"
                className="w-max min-w-[8.75rem]"
                buttonClassName={TASK_FILTER_BUTTON_CLASS}
                onValuesChange={setStatus}
              />
              {/* Same look as the Task toolbar's Overdue preset. */}
              <button
                type="button"
                onClick={() => setUnpaidOnly((value) => !value)}
                aria-pressed={unpaidOnly}
                title="Deals with a month, from Broker Effective until last month, that no payment covers"
                className={`inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-sm font-semibold transition ${
                  unpaidOnly ? "border-[#0c66e4] bg-[#deebff] text-[#0c66e4]" : "border-[#dfe1e6] bg-white text-[#42526e] hover:border-[#c1c7d0]"
                }`}
              >
                Unpaid months
              </button>
              <TableSettingsButton
                toggles={monthView ? monthView.all.map((c) => c.toggle) : dealView!.all.map((c) => c.toggle)}
                hidden={hidden}
                onToggle={(key) =>
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              />
              {filtersOn ? (
                <button
                  type="button"
                  onClick={() => {
                    setAgent([]);
                    setCarrier([]);
                    setStatus([]);
                    setQuery("");
                    setUnpaidOnly(false);
                  }}
                  className="h-9 shrink-0 px-1 text-sm font-medium text-[#0c66e4] transition hover:underline"
                >
                  Clear all
                </button>
              ) : null}
              <span
                className="ml-auto shrink-0 text-sm font-medium text-[#626f86]"
                title={`Google Sheet read at ${new Date(fetchedAt).toLocaleTimeString()}`}
              >
                {summary}
              </span>
            </div>
          </section>

          {editCount > 0 ? (
            <div className="flex items-center gap-3 rounded bg-[#fff7d6] px-3.5 py-2 text-sm font-semibold text-[#a54800]">
              <span className="flex-1">
                {editCount} unsaved change{editCount > 1 ? "s" : ""} — saving comes with the data step
              </span>
              <button type="button" className={pageSecondaryButtonClass()} onClick={discardEdits}>
                Discard
              </button>
            </div>
          ) : null}
          {notice ? (
            <div className="flex items-center gap-3 rounded bg-[#e9f2ff] px-3.5 py-2 text-sm font-semibold text-[#0c66e4]">
              <span className="flex-1">{notice}</span>
              <button type="button" className="text-[#0c66e4] hover:underline" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
        {monthView ? (
          <CommissionTable
            items={monthView.items}
            columns={monthView.columns}
            getKey={(row) => row.id}
            selectedKey={drawerKey}
            itemKey={(row) => keys.get(row.id) ?? ""}
            highlight={(row) => unpaidOfKey(keys.get(row.id) ?? "").length > 0}
            sort={sort}
            onSort={setSort}
            onOpenMonth={setMonth}
            edits={edits}
            onEdit={commitEdit}
          />
        ) : (
          <CommissionTable
            items={dealView!.items}
            columns={dealView!.columns}
            getKey={(deal) => deal.key}
            selectedKey={drawerKey}
            itemKey={(deal) => deal.key}
            highlight={(deal) => unpaidOfKey(deal.key).length > 0}
            sort={sort}
            onSort={setSort}
            onOpenMonth={(value) => {
              setMonth(value);
              setSort(null);
            }}
            expandedMonths={expandedMonths}
            onToggleMonth={(value) =>
              setExpandedMonths((current) => {
                const next = new Set(current);
                if (next.has(value)) next.delete(value);
                else next.add(value);
                return next;
              })
            }
            edits={edits}
            onEdit={commitEdit}
          />
        )}
      </div>

      {drawerKey ? (
        <DealDrawer
          rows={rows.filter((row) => keys.get(row.id) === drawerKey)}
          linkedAccount={(name) => accounts.find((account) => account.id === links[name]) ?? null}
          onClose={() => setDrawerKey(null)}
        />
      ) : null}
      {dialog === "upload" ? (
        <UploadMonthDialog
          rows={rows}
          links={links}
          onClose={() => setDialog(null)}
          onImport={importMonth}
        />
      ) : null}
      {dialog === "agents" ? (
        <AgentLinksDialog
          agents={agentCounts}
          accounts={accounts}
          links={links}
          onClose={() => setDialog(null)}
          onSave={(next) => {
            setLinks(next);
            setDialog(null);
          }}
        />
      ) : null}
    </main>
  );
}

function CommissionTable<T>({
  items,
  columns,
  getKey,
  itemKey,
  selectedKey,
  highlight,
  sort,
  onSort,
  onOpenMonth,
  expandedMonths,
  onToggleMonth,
  edits,
  onEdit,
}: {
  items: T[];
  columns: Column<T>[];
  getKey: (item: T) => string | number;
  itemKey: (item: T) => string;
  selectedKey: string | null;
  /** Rows that need attention get the Task list's overdue tint. */
  highlight?: (item: T) => boolean;
  sort: Sort;
  onSort: (sort: Sort) => void;
  onOpenMonth: (month: number) => void;
  expandedMonths?: ReadonlySet<number>;
  onToggleMonth?: (month: number) => void;
  edits: Edits;
  onEdit: (rowId: number, field: RowField, value: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ id: number; field: RowField } | null>(null);
  // Escape unmounts the input; its blur must not save what was typed.
  const cancelled = useRef(false);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => getKey(items[index]),
  });

  let left = 0;
  const pinnedLeft = columns.map((column) => {
    if (!column.pinned) return null;
    const at = left;
    left += column.width;
    return at;
  });
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  const lastPinned = pinnedLeft.reduce<number>((last, value, index) => (value === null ? last : index), -1);
  const grouped = columns.some((column) => column.group);
  const footers = useMemo(
    () => (columns.some((column) => column.footer) ? columns.map((column) => column.footer?.(items) ?? null) : null),
    [columns, items],
  );

  // Consecutive columns of one group share a header cell (and can share one body cell).
  const groupEnd = columns.map(() => 0);
  const groups: Array<{ label: string; width: number; month?: number; index: number }> = [];
  columns.forEach((column, index) => {
    const previous = groups[groups.length - 1];
    if (column.group && previous && previous.label === column.group && !column.groupStart) previous.width += column.width;
    else groups.push({ label: column.group ?? "", width: column.width, month: column.groupMonth, index });
  });
  groups.forEach((group, at) => {
    const end = (groups[at + 1]?.index ?? columns.length) - 1;
    groupEnd[group.index] = end;
  });

  // Same cell box as a Task list row: px-3, pinned cells sticky with a right rule.
  const cellClass = (column: Column<T>, index: number) =>
    `flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap px-3 ${column.align === "right" ? "justify-end text-right" : ""} ${
      pinnedLeft[index] !== null ? "border-r border-[#dfe1e6]" : ""
    } ${column.groupStart ? "border-l border-[#dfe1e6]" : ""}`;

  if (items.length === 0) {
    return (
      <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
        Nothing matches these filters.
      </div>
    );
  }

  const editor = (target: { row: HealthCommissionRow; field: RowField }) => (
    <input
      autoFocus
      defaultValue={target.row[target.field]}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          setEditing(null);
        }
      }}
      onBlur={(event) => {
        if (!cancelled.current) onEdit(target.row.id, target.field, event.target.value);
        setEditing(null);
      }}
      className="h-8 w-full rounded border border-[#dfe1e6] bg-white px-2 text-xs font-semibold text-[#172b4d] outline-none transition focus:border-[#0c66e4]"
    />
  );
  const startEdit = (target: { row: HealthCommissionRow; field: RowField } | null) => {
    if (!target) return;
    cancelled.current = false;
    setEditing({ id: target.row.id, field: target.field });
  };
  const isEditingTarget = (target: { row: HealthCommissionRow; field: RowField } | null) =>
    Boolean(target && editing && target.row.id === editing.id && target.field === editing.field);

  return (
    <div className={TABLE_FRAME_CLASS}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ width }}>
          <div className="sticky top-0 z-20 border-b border-[#dfe1e6] bg-[#fafbfc] text-[11px] font-bold uppercase tracking-wide text-[#6b778c] shadow-[0_1px_0_#dfe1e6]">
            {grouped ? (
              <div className="flex h-8 items-stretch whitespace-nowrap border-b border-[#ebecf0]">
                {groups.map((group) => {
                  const pinned = pinnedLeft[group.index] !== null;
                  if (group.month) {
                    const open = expandedMonths?.has(group.month) ?? false;
                    return (
                      <div
                        key={`${group.label}-${group.index}`}
                        style={{ width: group.width }}
                        className="flex shrink-0 items-center justify-center gap-1 border-l border-[#dfe1e6] bg-[#fafbfc]"
                      >
                        <button
                          type="button"
                          onClick={() => onToggleMonth?.(group.month!)}
                          title={open ? `Show only ${group.label}'s Messer Paid` : `Show all of ${group.label}`}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-[#172b4d] transition hover:bg-[#e9f2ff] hover:text-[#0c66e4]"
                        >
                          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {group.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenMonth(group.month!)}
                          title={`Open ${group.label} only`}
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-[#8590a2] transition hover:bg-[#e9f2ff] hover:text-[#0c66e4]"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={`${group.label}-${group.index}`}
                      style={{ width: group.width, left: pinned ? pinnedLeft[group.index]! : undefined }}
                      className={`flex shrink-0 items-center justify-center ${pinned ? "sticky z-[30] bg-[#fafbfc]" : ""} ${
                        group.label ? "border-l border-[#dfe1e6] bg-[#fafbfc] text-[12px] text-[#172b4d]" : "bg-[#fafbfc]"
                      }`}
                    >
                      {group.label}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="flex items-stretch whitespace-nowrap">
              {columns.map((column, index) => {
                const active = sort?.key === column.key;
                return (
                  <button
                    key={column.key}
                    type="button"
                    disabled={!column.sortValue}
                    onClick={() => {
                      if (!active) return onSort({ key: column.key, dir: "asc" });
                      onSort(sort!.dir === "asc" ? { key: column.key, dir: "desc" } : null);
                    }}
                    style={{ width: column.width, left: pinnedLeft[index] ?? undefined }}
                    className={`${cellClass(column, index)} gap-1 py-2 uppercase transition disabled:cursor-default ${
                      pinnedLeft[index] !== null ? "sticky z-[30]" : ""
                    } bg-[#fafbfc] ${active ? "text-[#0c66e4]" : column.sortValue ? "hover:text-[#172b4d]" : ""}`}
                  >
                    <span className="truncate">{column.label}</span>
                    {active ? sort!.dir === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rows placed with `top`, not transform: pinned cells are sticky. */}
          <ul style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              const selected = selectedKey !== null && itemKey(item) === selectedKey;
              const flagged = highlight?.(item) ?? false;
              const rowBg = selected
                ? "bg-[#f5f9ff]"
                : flagged
                  ? "bg-[#fdecef] group-hover:bg-[#fbdde3]"
                  : "bg-white group-hover:bg-[#f7f8f9]";
              const cells: ReactNode[] = [];
              for (let index = 0; index < columns.length; index += 1) {
                const column = columns[index];
                const pinnedClass =
                  pinnedLeft[index] !== null ? `sticky z-[2] ${rowBg}` : "";
                const merged = column.groupStart ? column.merged?.(item) ?? null : null;
                if (merged) {
                  const end = groupEnd[index];
                  let spanWidth = 0;
                  for (let at = index; at <= end; at += 1) spanWidth += columns[at].width;
                  cells.push(
                    <div
                      key={column.key}
                      onDoubleClick={() => startEdit(merged.edit)}
                      style={{ width: spanWidth }}
                      className={`flex shrink-0 items-center ${index === end ? "justify-end px-3" : "justify-center px-2"} border-l border-[#dfe1e6] py-1.5 ${pinnedClass} ${
                        merged.edit && edits.get(merged.edit.row.id)?.[merged.edit.field] !== undefined ? "!bg-[#fff7d6]" : ""
                      }`}
                    >
                      {isEditingTarget(merged.edit) ? (
                        editor(merged.edit!)
                      ) : merged.code ? (
                        // One column: the code alone, aligned with the amounts.
                        <CodeBand code={merged.code} compact={index === end} />
                      ) : (
                        <CellValue field="ar" value="" />
                      )}
                    </div>,
                  );
                  index = end;
                  continue;
                }
                const target = column.editTarget?.(item) ?? null;
                const edited = Boolean(target && edits.get(target.row.id)?.[target.field] !== undefined);
                cells.push(
                  <div
                    key={column.key}
                    onDoubleClick={() => startEdit(target)}
                    style={{ width: column.width, left: pinnedLeft[index] ?? undefined }}
                    className={`${cellClass(column, index)} ${column.dense ? "py-1" : "py-2.5"} ${pinnedClass} ${edited ? "!bg-[#fff7d6] shadow-[inset_0_-2px_0_#f5cd47]" : ""} ${
                      isEditingTarget(target) ? "!px-1.5" : ""
                    }`}
                  >
                    {isEditingTarget(target) ? editor(target!) : column.render(item)}
                  </div>,
                );
              }
              return (
                <li
                  key={virtualRow.key}
                  className={`group absolute left-0 flex border-b border-[#ebecf0] text-sm text-[#172b4d] ${
                    selected ? "bg-[#f5f9ff]" : flagged ? "bg-[#fdecef] hover:bg-[#fbdde3]" : "bg-white hover:bg-[#f7f8f9]"
                  }`}
                  style={{ top: virtualRow.start, height: ROW_HEIGHT, width }}
                >
                  {cells}
                </li>
              );
            })}
          </ul>

          {footers ? (
            // pb-3 keeps the totals above macOS's overlay scrollbar, which draws over the bottom edge.
            <div className="sticky bottom-0 z-20 flex h-[52px] items-stretch whitespace-nowrap border-t border-[#dfe1e6] bg-[#fafbfc] pb-3 text-sm font-bold text-[#172b4d] shadow-[0_-1px_0_#dfe1e6]">
              {columns.map((column, index) => (
                <div
                  key={column.key}
                  style={{ width: column.width, left: pinnedLeft[index] ?? undefined }}
                  className={`${cellClass(column, index)} bg-[#fafbfc] ${pinnedLeft[index] !== null ? "sticky z-[2]" : ""}`}
                >
                  {index === lastPinned ? <span className="text-[11px] uppercase tracking-wide text-[#6b778c]">Total</span> : footers[index]}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The Task list's "Table settings" button: tick the columns to show. */
function TableSettingsButton({
  toggles,
  hidden,
  onToggle,
}: {
  toggles: Array<{ key: string; label: string } | undefined>;
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle } = useAnchoredMenu();
  const entries = [...new Map(toggles.flatMap((toggle) => (toggle ? [[toggle.key, toggle.label] as const] : []))).entries()];
  const hiddenCount = entries.filter(([key]) => hidden.has(key)).length;
  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        title="Table settings"
        aria-label={hiddenCount > 0 ? `Table settings, ${hiddenCount} hidden columns` : "Table settings"}
        aria-expanded={isOpen}
        className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-white text-[#44546f] shadow-[0_1px_3px_rgba(22,35,58,0.12)] transition hover:border-[#b8c5d6] hover:bg-[#f8fafc] hover:text-[#172b4d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#deebff] ${
          isOpen ? "border-[#0c66e4] text-[#0c66e4]" : "border-[#dfe1e6]"
        }`}
      >
        <Settings2 className="h-[18px] w-[18px]" />
        {hiddenCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#deebff] px-1 text-[10px] font-bold leading-none text-[#0c66e4] ring-2 ring-white">
            {hiddenCount}
          </span>
        ) : null}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="dashboard-filter-menu z-[110] flex max-h-[calc(100vh-6rem)] w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden p-2"
            >
              <div className="border-b border-[#ebecf0] px-2 py-2">
                <div className="flex items-center gap-2 text-sm font-bold text-[#172b4d]">
                  <Settings2 className="h-4 w-4 text-[#0c66e4]" />
                  Table settings
                </div>
                <div className="mt-1 text-[11px] font-medium text-[#6b778c]">Choose which table columns are visible.</div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto py-1">
                {entries.map(([key, label]) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-semibold text-[#172b4d] transition hover:bg-[#f4f5f7]"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden.has(key)}
                      onChange={() => onToggle(key)}
                      className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]"
                    />
                    <span className="min-w-0 truncate">{label}</span>
                  </label>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

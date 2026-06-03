"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileDown, Filter } from "lucide-react";
import * as XLSX from "xlsx";
import { PcStateHeatMap } from "../../sales-dashboard/pc/PcStateHeatMap";

export type AgentPcRow = {
  agent_name: string | null;
  agency_name: string | null;
  insured_name: string | null;
  type: string | null;
  company: string | null;
  policy_number: string | null;
  premium: number | null;
  true_premium: number | null;
  effective_date: string | null;
  expired_date: string | null;
  status: string | null;
  paid_producer: string | null;
  statement_number: string | null;
  agent_commission_amount: number | null;
  state: string | null;
  city: string | null;
};

export type AgentPcExpiredMonthRow = {
  monthKey: string;
  policyCount: number;
  totalPremium: number;
};

export type AgentPcFilterOptions = {
  agencies: string[];
};

export type AgentPcFilterValues = {
  agency: string;
  policyNumber: string;
};

type TrendLevel = "month" | "quarter" | "year";

type Summary = {
  policyCount: number;
  activePolicyCount: number;
  renewalPolicyCount: number;
  totalPremium: number;
  agentCommission: number;
};

type PeriodSummary = Summary & {
  periodKey: string;
  periodLabel: string;
};

type PeriodGrowthRow = PeriodSummary & {
  agentCommissionChange: number | null;
  agentCommissionChangePercent: number | null;
  policyChange: number | null;
  policyChangePercent: number | null;
  premiumChange: number | null;
  premiumChangePercent: number | null;
};

type CarrierSummary = Summary & {
  company: string;
  policySharePercent: number;
  agentCommissionRate: number;
};

type StateCityRow = Summary & {
  state: string;
  city: string;
  isTotal: boolean;
  policySharePercent: number;
};

type StateGroup = {
  state: string;
  rows: StateCityRow[];
};

type PolicyDetailRow = {
  agency: string;
  agent: string;
  carrier: string;
  effectiveDate: string | null;
  expiredDate: string | null;
  insuredName: string;
  policyNumber: string;
  premium: number;
  agentCommission: number;
  status: string;
  type: string;
};

type DashboardData = {
  carrierRows: CarrierSummary[];
  stateGroups: StateGroup[];
  statePolicyCounts: Record<string, number>;
  overview: Summary;
  growthRowsByLevel: Record<TrendLevel, PeriodGrowthRow[]>;
  policyDetailRows: PolicyDetailRow[];
  periodsByLevel: Record<TrendLevel, PeriodSummary[]>;
};

type SortDirection = "asc" | "desc";
type PolicySortKey =
  | "agent"
  | "insuredName"
  | "policyNumber"
  | "carrier"
  | "agency"
  | "premium"
  | "agentCommission"
  | "effectiveDate"
  | "expiredDate"
  | "status";
type PolicySortState = { key: PolicySortKey; direction: SortDirection };
type PolicyFilterOption = { label: string; value: string };
type DateRange = { from: string; to: string };

const TREND_LIMIT_BY_LEVEL: Record<TrendLevel, number> = {
  month: 12,
  quarter: 8,
  year: 5,
};
const SALES_MOM_VISIBLE_ROW_COUNT = 6;
const SALES_MOM_HEADER_HEIGHT_PX = 44;
const SALES_MOM_ROW_HEIGHT_PX = 56;
const SALES_MOM_SCROLL_MAX_HEIGHT =
  SALES_MOM_HEADER_HEIGHT_PX +
  SALES_MOM_VISIBLE_ROW_COUNT * SALES_MOM_ROW_HEIGHT_PX;
const POLICY_DETAIL_VISIBLE_ROW_COUNT = 10;
const POLICY_DETAIL_HEADER_HEIGHT_PX = 48;
const POLICY_DETAIL_ROW_HEIGHT_PX = 48;
const POLICY_DETAIL_TABLE_MAX_HEIGHT =
  POLICY_DETAIL_HEADER_HEIGHT_PX +
  POLICY_DETAIL_VISIBLE_ROW_COUNT * POLICY_DETAIL_ROW_HEIGHT_PX;

export function AgentPcDashboard({
  agentName,
  canViewAll,
  expiredMonthKeys,
  expiredRows: expiredSourceRows,
  filterOptions,
  filters,
  rows,
}: {
  agentName: string;
  canViewAll: boolean;
  expiredMonthKeys: string[];
  expiredRows: AgentPcRow[];
  filterOptions: AgentPcFilterOptions;
  filters: AgentPcFilterValues;
  rows: AgentPcRow[] | null;
}) {
  const [clientFilters, setClientFilters] = useState(filters);
  const [trendLevel, setTrendLevel] = useState<TrendLevel>("month");
  const filteredRows = useMemo(
    () => (rows ? applyClientFilters(rows, clientFilters) : []),
    [clientFilters, rows]
  );
  const expiredRows = useMemo(
    () =>
      buildExpiredMonthRows(
        applyClientFilters(expiredSourceRows, clientFilters),
        expiredMonthKeys
      ),
    [clientFilters, expiredMonthKeys, expiredSourceRows]
  );
  const data = useMemo(() => buildDashboardData(filteredRows), [filteredRows]);
  const stateHeatMapGroups = useMemo(
    () =>
      data.stateGroups.map((group) => ({
        state: group.state,
        rows: group.rows.map((row) => ({
          state: row.state,
          city: row.city,
          isTotal: row.isTotal,
          policyCount: row.policyCount,
          policySharePercent: row.policySharePercent,
          totalPremium: row.totalPremium,
          totalCommission: row.agentCommission,
        })),
      })),
    [data.stateGroups]
  );
  const trendRows = data.periodsByLevel[trendLevel];
  const growthRows = data.growthRowsByLevel[trendLevel];
  const overviewDescription = canViewAll
    ? "Showing agent-facing P&C metrics for all agents."
    : `Showing P&C dashboard for ${agentName || "your account"}.`;

  function updateClientFilters(nextFilters: AgentPcFilterValues) {
    setClientFilters(nextFilters);
    syncClientFilterUrl(nextFilters);
  }

  if (!rows) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-8 py-16 text-center text-sm font-medium text-slate-500 shadow-sm">
        Your account name is required to load P&amp;C agent dashboard data.
      </div>
    );
  }

  return (
    <>
      <AgentPcDashboardFilters
        filters={clientFilters}
        onChange={updateClientFilters}
        options={filterOptions}
      />

      {filteredRows.length === 0 ? (
        <div className="space-y-8">
          <div className="rounded-xl border border-slate-200 bg-white px-8 py-16 text-center text-sm font-medium text-slate-500 shadow-sm">
            No P&amp;C records match these filters.
          </div>
          <ExpiredPolicyTrendChart rows={expiredRows} />
        </div>
      ) : (
        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              Personal Overview
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {overviewDescription}
            </p>
          </div>

          <section className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Agent Commission"
              value={formatCurrencyCompact(data.overview.agentCommission)}
            />
            <KpiCard
              label="Written Premium"
              value={formatCurrencyCompact(data.overview.totalPremium)}
            />
            <KpiCard
              label="Policies"
              value={formatInteger(data.overview.policyCount)}
            />
            <KpiCard
              label="Active Policies"
              value={formatInteger(data.overview.activePolicyCount)}
            />
          </section>

          <section className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              compact
              label="Renewal Rate"
              value={formatPercent(
                percentOf(
                  data.overview.renewalPolicyCount,
                  data.overview.policyCount
                )
              )}
            />
            <KpiCard
              compact
              label="Agent Comm Rate"
              value={formatPercent(
                percentOf(
                  data.overview.agentCommission,
                  data.overview.totalPremium
                )
              )}
            />
            <KpiCard
              compact
              muted
              label="Average Premium / Policy"
              value={formatCurrencyCompact(
                data.overview.policyCount === 0
                  ? 0
                  : data.overview.totalPremium / data.overview.policyCount
              )}
            />
            <KpiCard
              compact
              muted
              label="Average Commission / Policy"
              value={formatCurrencyCompact(
                data.overview.policyCount === 0
                  ? 0
                  : data.overview.agentCommission / data.overview.policyCount
              )}
            />
          </section>

          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xl font-bold tracking-tight text-slate-900">
                {trendLevelAdjective(trendLevel)} Portfolio &amp; Premium Trend
              </h3>
              <TrendLevelTabs value={trendLevel} onChange={setTrendLevel} />
            </div>
            <AgentPcSalesVolumePremiumTrendChart rows={trendRows} />
          </section>

          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xl font-bold tracking-tight text-slate-900">
                Commission Trend by {trendLevelLabel(trendLevel)} | Agent Commission
              </h3>
            </div>
            <AgentPcCommissionTrendChart rows={trendRows} />
          </section>

          <PeriodGrowthTable rows={growthRows} trendLevel={trendLevel} />

          <section className="grid min-w-0 items-start gap-8 xl:grid-cols-2">
            <CarrierDashboardOverview rows={data.carrierRows} />
            <StateCityPerformanceTable groups={data.stateGroups} />
          </section>

          <PcStateHeatMap
            counts={data.statePolicyCounts}
            groups={stateHeatMapGroups}
          />

          <ExpiredPolicyTrendChart rows={expiredRows} />

          <PolicyDetailsTable
            rows={data.policyDetailRows}
            showAgent={canViewAll}
          />
        </div>
      )}
    </>
  );
}

function AgentPcDashboardFilters({
  filters,
  onChange,
  options,
}: {
  filters: AgentPcFilterValues;
  onChange: (filters: AgentPcFilterValues) => void;
  options: AgentPcFilterOptions;
}) {
  const [policyNumber, setPolicyNumber] = useState(filters.policyNumber);

  function updateFilter(name: keyof AgentPcFilterValues, value: string) {
    const nextFilters = {
      ...filters,
      [name]: value,
    };

    if (name === "policyNumber") {
      setPolicyNumber(value);
    }

    onChange(nextFilters);
  }

  function applyPolicyNumberFilter() {
    updateFilter("policyNumber", policyNumber.trim());
  }

  return (
    <div className="mb-8 flex flex-wrap items-center justify-end gap-3">
      <FilterSelect
        label="Agency"
        onChange={(value) => updateFilter("agency", value)}
        options={options.agencies}
        placeholder="All agencies"
        value={filters.agency}
      />
      <label className="block w-[15rem] shrink-0">
        <span className="sr-only">Policy Number</span>
        <input
          aria-label="Policy Number"
          className="dashboard-filter-input"
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

function FilterSelect({
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  value: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const buttonLabel = value || placeholder;

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
    <div ref={containerRef} className="relative w-[15rem] shrink-0">
      <button
        aria-expanded={isOpen}
        aria-label={label}
        className="dashboard-filter-button w-full"
        data-filter-name={label.toLowerCase()}
        onClick={openDropdown}
        type="button"
      >
        <span className="truncate">{buttonLabel}</span>
        <span aria-hidden="true" className="text-[#667085]">
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
                  className="dashboard-filter-option w-full"
                  key={option}
                  onClick={() => setDraftValue(option)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`dashboard-filter-checkbox ${
                      draftValue === option ? "checked-like" : ""
                    }`}
                  />
                  <span className="truncate">{option}</span>
                </button>
              ))
            )}
          </div>

          <div className="dashboard-filter-footer mt-3">
            <button
              className="dashboard-filter-action mr-auto text-[#667085]"
              onClick={clearSelection}
              type="button"
            >
              Clear
            </button>
            <button
              className="dashboard-filter-action"
              onClick={closeWithoutApplying}
              type="button"
            >
              Cancel
            </button>
            <button
              className="dashboard-filter-action"
              onClick={applySelection}
              type="button"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TrendLevelTabs({
  onChange,
  value,
}: {
  onChange: (value: TrendLevel) => void;
  value: TrendLevel;
}) {
  const tabs: TrendLevel[] = ["month", "quarter", "year"];

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-[#cfd7e3] bg-white shadow-[0_1px_2px_rgba(22,35,58,0.08)]">
      {tabs.map((tab) => {
        const active = tab === value;

        return (
          <button
            aria-pressed={active}
            className={`h-10 min-w-[5.5rem] px-4 text-sm font-semibold transition ${
              active
                ? "bg-[#1f5b96] text-white"
                : "text-[#344054] hover:bg-[#f3f6fa]"
            }`}
            key={tab}
            onClick={() => onChange(tab)}
            type="button"
          >
            {trendLevelLabel(tab)}
          </button>
        );
      })}
    </div>
  );
}

function AgentPcSalesVolumePremiumTrendChart({
  rows,
}: {
  rows: PeriodSummary[];
}) {
  const width = 1280;
  const height = 410;
  const left = 76;
  const right = 86;
  const top = 62;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxPremium = roundAxisMax(maxValue(rows, (row) => row.totalPremium));
  const maxPolicies = roundAxisMax(maxValue(rows, (row) => row.policyCount));
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(54, Math.max(24, groupWidth * 0.55));
  const points = rows.map((row, index) => {
    const centerX = left + index * groupWidth + groupWidth / 2;
    const premiumHeight = (row.totalPremium / maxPremium) * plotHeight;

    return {
      ...row,
      centerX,
      policyY: top + plotHeight - (row.policyCount / maxPolicies) * plotHeight,
      premiumHeight,
      premiumY: top + plotHeight - premiumHeight,
    };
  });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">
          No sales trend data.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <svg
            aria-label="P&C agent sales volume and premium trend"
            className="min-w-[1120px]"
            role="img"
            viewBox={`0 0 ${width} ${height}`}
          >
            <g transform="translate(86, 22)">
              <line
                x1="0"
                x2="34"
                y1="8"
                y2="8"
                stroke="#347cf4"
                strokeWidth="3"
              />
              <circle cx="17" cy="8" r="5" fill="#347cf4" />
              <text
                x="44"
                y="13"
                className="fill-[#40444b] text-[15px] font-semibold"
              >
                Policies Count
              </text>
              <rect x="178" width="34" height="16" fill="#fa9d4a" />
              <text
                x="222"
                y="13"
                className="fill-[#40444b] text-[15px] font-semibold"
              >
                Total Premium
              </text>
            </g>

            {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
              const y = top + plotHeight - tick * plotHeight;

              return (
                <g key={tick}>
                  <line
                    stroke="#d6d6d6"
                    x1={left}
                    x2={width - right}
                    y1={y}
                    y2={y}
                  />
                  <text
                    className="fill-[#4a4f58] text-[12px]"
                    textAnchor="end"
                    x={left - 14}
                    y={y + 5}
                  >
                    {formatAxisMoney(maxPremium * tick)}
                  </text>
                  <text
                    className="fill-[#4a4f58] text-[12px]"
                    x={width - right + 14}
                    y={y + 5}
                  >
                    {formatInteger(maxPolicies * tick)}
                  </text>
                </g>
              );
            })}

            <text
              className="fill-[#4d545f] text-[13px] font-semibold"
              textAnchor="middle"
              transform={`rotate(-90 22 ${top + plotHeight / 2})`}
              x={22}
              y={top + plotHeight / 2}
            >
              Total Premium
            </text>
            <text
              className="fill-[#4d545f] text-[13px] font-semibold"
              textAnchor="middle"
              transform={`rotate(-90 ${width - 24} ${top + plotHeight / 2})`}
              x={width - 24}
              y={top + plotHeight / 2}
            >
              Policies Count
            </text>

            {points.map((point) => (
              <g key={point.periodKey}>
                <rect
                  fill="#fa9d4a"
                  height={Math.max(point.premiumHeight, 2)}
                  width={barWidth}
                  x={point.centerX - barWidth / 2}
                  y={point.premiumY}
                />
                <text
                  className="fill-[#252a31] text-[15px] font-bold"
                  textAnchor="middle"
                  x={point.centerX}
                  y={Math.max(point.premiumY - 10, top + 16)}
                >
                  {formatCurrencyShort(point.totalPremium)}
                </text>
                <text
                  className="fill-[#3e444d] text-[13px] font-semibold"
                  textAnchor="middle"
                  x={point.centerX}
                  y={top + plotHeight + 30}
                >
                  {point.periodLabel}
                </text>
              </g>
            ))}

            <path
              d={points
                .map(
                  (point, index) =>
                    `${index === 0 ? "M" : "L"} ${point.centerX} ${point.policyY}`
                )
                .join(" ")}
              fill="none"
              stroke="#347cf4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
            />

            {points.map((point) => (
              <g key={`${point.periodKey}-policies`}>
                <circle cx={point.centerX} cy={point.policyY} fill="#347cf4" r="5" />
                <text
                  className="fill-[#347cf4] text-[15px] font-bold"
                  textAnchor="middle"
                  x={point.centerX}
                  y={point.policyY - 12}
                >
                  {formatInteger(point.policyCount)}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

function AgentPcCommissionTrendChart({ rows }: { rows: PeriodSummary[] }) {
  const width = 1280;
  const height = 360;
  const left = 76;
  const right = 96;
  const top = 62;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxAmount = roundAxisMax(maxValue(rows, (row) => row.agentCommission));
  const maxRate = Math.max(
    10,
    roundAxisMax(
      maxValue(rows, (row) => percentOf(row.agentCommission, row.totalPremium))
    )
  );
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(48, Math.max(20, groupWidth * 0.52));
  const points = rows.map((row, index) => {
    const rate = percentOf(row.agentCommission, row.totalPremium);
    const centerX = left + index * groupWidth + groupWidth / 2;
    const barHeight = (row.agentCommission / maxAmount) * plotHeight;
    const barY = top + plotHeight - barHeight;
    const lineY = top + plotHeight - (rate / maxRate) * plotHeight;
    const amountLabelY = resolveAmountLabelY({
      barHeight,
      barY,
      lineY,
      plotBottom: top + plotHeight,
      plotTop: top,
    });

    return {
      ...row,
      amountLabelY,
      barHeight,
      barY,
      centerX,
      lineY,
      rate,
    };
  });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm font-medium text-slate-500">
          No commission trend data.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <svg
            aria-label="P&C agent commission trend by month"
            className="min-w-[1120px]"
            role="img"
            viewBox={`0 0 ${width} ${height}`}
          >
            <g transform="translate(86, 22)">
              <rect width="34" height="14" fill="#d6d6d6" />
              <text
                className="fill-[#40444b] text-[14px] font-semibold"
                x="44"
                y="13"
              >
                Agent Commission
              </text>
              <line
                x1="220"
                x2="254"
                y1="8"
                y2="8"
                stroke="#d94242"
                strokeWidth="3"
              />
              <circle cx="237" cy="8" r="5" fill="#d94242" />
              <text
                className="fill-[#40444b] text-[14px] font-semibold"
                x="264"
                y="13"
              >
                Agent Commission / Premium
              </text>
            </g>

            {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
              const y = top + plotHeight - tick * plotHeight;

              return (
                <g key={tick}>
                  <line
                    stroke="#d6d6d6"
                    x1={left}
                    x2={width - right}
                    y1={y}
                    y2={y}
                  />
                  <text
                    className="fill-[#4a4f58] text-[12px]"
                    textAnchor="end"
                    x={left - 14}
                    y={y + 5}
                  >
                    {formatAxisMoney(maxAmount * tick)}
                  </text>
                  <text
                    className="fill-[#4a4f58] text-[12px]"
                    x={width - right + 14}
                    y={y + 5}
                  >
                    {formatPercent(maxRate * tick)}
                  </text>
                </g>
              );
            })}

            {points.map((point) => (
              <g key={point.periodKey}>
                <rect
                  fill="#d6d6d6"
                  height={Math.max(point.barHeight, 2)}
                  width={barWidth}
                  x={point.centerX - barWidth / 2}
                  y={point.barY}
                />
                <text
                  className="fill-[#252a31] text-[13px] font-bold"
                  textAnchor="middle"
                  x={point.centerX}
                  y={point.amountLabelY}
                >
                  {formatCurrencyShort(point.agentCommission)}
                </text>
                <text
                  className="fill-[#3e444d] text-[12px] font-semibold"
                  textAnchor="middle"
                  x={point.centerX}
                  y={top + plotHeight + 28}
                >
                  {point.periodLabel}
                </text>
              </g>
            ))}

            <path
              d={points
                .map(
                  (point, index) =>
                    `${index === 0 ? "M" : "L"} ${point.centerX} ${point.lineY}`
                )
                .join(" ")}
              fill="none"
              stroke="#d94242"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
            />

            {points.map((point) => (
              <g key={`${point.periodKey}-commission-rate`}>
                <circle cx={point.centerX} cy={point.lineY} fill="#d94242" r="4" />
                <text
                  className="fill-[#d94242] text-[12px] font-bold"
                  textAnchor="middle"
                  x={point.centerX}
                  y={point.lineY - 12}
                >
                  {formatPercent(point.rate)}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

function PeriodGrowthTable({
  rows,
  trendLevel,
}: {
  rows: PeriodGrowthRow[];
  trendLevel: TrendLevel;
}) {
  const periodLabel = trendLevelLabel(trendLevel);
  const changeLabel = getChangeLabel(trendLevel);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold leading-tight text-[#16233a]">
          Book &amp; Commission Trend by {periodLabel} | {changeLabel}
        </h2>
      </div>

      <article className="agent-health-panel">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#667085]">
            No production periods.
          </div>
        ) : (
          <div
            className="overflow-y-auto overflow-x-hidden"
            style={{ maxHeight: SALES_MOM_SCROLL_MAX_HEIGHT }}
          >
            <table className="w-full table-fixed text-[13px] text-[#344054]">
              <thead>
                <tr className="border-b border-[#d8dee7] bg-[#f8fafc] text-left text-xs font-semibold uppercase text-[#667085]">
                  <MoMHeaderCell className="sticky left-0 top-0 z-30 w-[13%] bg-[#f8fafc]">
                    {periodLabel}
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[13%] text-right">
                    Policies
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[14%] text-right">
                    % Policies {changeLabel}
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[15%] text-right">
                    Total Premium
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[14%] text-right">
                    % Premium {changeLabel}
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[16%] text-right">
                    Agent Commission
                  </MoMHeaderCell>
                  <MoMHeaderCell className="top-0 w-[15%] text-right">
                    % Agent Comm {changeLabel}
                  </MoMHeaderCell>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const rowBg = index % 2 === 0 ? "bg-white" : "bg-[#f8fafc]";

                  return (
                    <tr
                      className={`h-14 border-b border-[#edf0f4] ${rowBg}`}
                      key={row.periodKey}
                    >
                      <td
                        className={`sticky left-0 z-10 border-r border-[#e3e8ef] px-3 py-3 text-sm ${rowBg}`}
                      >
                        {row.periodLabel}
                      </td>
                      <MoMMetricCell
                        changeLabel={changeLabel}
                        delta={row.policyChange}
                        value={formatInteger(row.policyCount)}
                      />
                      <MoMPercentCell value={row.policyChangePercent} />
                      <MoMMetricCell
                        changeLabel={changeLabel}
                        delta={row.premiumChange}
                        deltaType="currency"
                        value={formatCurrencyShort(row.totalPremium)}
                      />
                      <MoMPercentCell value={row.premiumChangePercent} />
                      <MoMMetricCell
                        changeLabel={changeLabel}
                        delta={row.agentCommissionChange}
                        deltaType="currency"
                        value={formatCurrencyShort(row.agentCommission)}
                      />
                      <MoMPercentCell value={row.agentCommissionChangePercent} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

function ExpiredPolicyTrendChart({
  rows,
}: {
  rows: AgentPcExpiredMonthRow[];
}) {
  const width = 1280;
  const height = 360;
  const left = 76;
  const right = 86;
  const top = 56;
  const bottom = 56;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxPremium = roundAxisMax(maxValue(rows, (row) => row.totalPremium));
  const maxPolicies = roundAxisMax(maxValue(rows, (row) => row.policyCount));
  const groupWidth = plotWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(80, groupWidth * 0.7);
  const points = rows.map((row, index) => {
    const centerX = left + index * groupWidth + groupWidth / 2;
    const barHeight = (row.totalPremium / maxPremium) * plotHeight;

    return {
      ...row,
      barHeight,
      barY: top + plotHeight - barHeight,
      centerX,
      policyY: top + plotHeight - (row.policyCount / maxPolicies) * plotHeight,
    };
  });

  return (
    <ReportPanel title="Monthly Expired Policy">
      <div className="overflow-x-auto">
          <svg
            aria-label="Monthly expired policy"
            className="min-w-[1120px]"
            role="img"
            viewBox={`0 0 ${width} ${height}`}
          >
            <g transform="translate(86, 20)">
              <rect fill="#ff8a00" height="16" width="34" x="0" />
              <text
                className="fill-[#40444b] text-[15px] font-semibold"
                x="44"
                y="13"
              >
                Total Premium
              </text>
              <line
                stroke="#347cf4"
                strokeWidth="3"
                x1="196"
                x2="230"
                y1="8"
                y2="8"
              />
              <circle cx="213" cy="8" fill="#347cf4" r="5" />
              <text
                className="fill-[#40444b] text-[15px] font-semibold"
                x="240"
                y="13"
              >
                # Policy
              </text>
            </g>

            {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
              const y = top + plotHeight - tick * plotHeight;

              return (
                <g key={tick}>
                  <line
                    stroke="#d6d6d6"
                    x1={left}
                    x2={width - right}
                    y1={y}
                    y2={y}
                  />
                  <text
                    className="fill-[#4a4f58] text-[13px]"
                    textAnchor="end"
                    x={left - 14}
                    y={y + 5}
                  >
                    {formatAxisMoney(maxPremium * tick)}
                  </text>
                  <text
                    className="fill-[#4a4f58] text-[13px]"
                    x={width - right + 14}
                    y={y + 5}
                  >
                    {formatInteger(maxPolicies * tick)}
                  </text>
                </g>
              );
            })}

            {points.map((point) => (
              <g key={point.monthKey}>
                <rect
                  fill="#ff8a00"
                  height={Math.max(point.barHeight, 2)}
                  width={barWidth}
                  x={point.centerX - barWidth / 2}
                  y={point.barY}
                />
                <text
                  className="fill-white text-[16px] font-bold"
                  textAnchor="middle"
                  x={point.centerX}
                  y={Math.max(point.barY + 24, top + 20)}
                >
                  {formatCurrencyShort(point.totalPremium)}
                </text>
                <text
                  className="fill-[#3e444d] text-[13px] font-semibold"
                  textAnchor="middle"
                  x={point.centerX}
                  y={top + plotHeight + 30}
                >
                  {point.monthKey}
                </text>
              </g>
            ))}

            <path
              d={points
                .map(
                  (point, index) =>
                    `${index === 0 ? "M" : "L"} ${point.centerX} ${point.policyY}`
                )
                .join(" ")}
              fill="none"
              stroke="#347cf4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
            />

            {points.map((point) => (
              <g key={`${point.monthKey}-policy`}>
                <circle cx={point.centerX} cy={point.policyY} fill="#347cf4" r="5" />
                <text
                  className="fill-[#347cf4] text-[16px] font-bold"
                  textAnchor="middle"
                  x={point.centerX}
                  y={point.policyY - 12}
                >
                  {formatInteger(point.policyCount)}
                </text>
              </g>
            ))}
          </svg>
        </div>
    </ReportPanel>
  );
}

function MoMHeaderCell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`sticky z-20 border-r border-[#d8dee7] bg-[#f8fafc] px-2 py-2.5 font-semibold leading-tight last:border-r-0 ${className}`}
    >
      <span className="block whitespace-normal break-words">{children}</span>
    </th>
  );
}

function MoMMetricCell({
  changeLabel,
  delta,
  deltaType = "integer",
  value,
}: {
  changeLabel: string;
  delta: number | null;
  deltaType?: "integer" | "currency";
  value: string;
}) {
  const formattedDelta =
    delta === null
      ? "-"
      : deltaType === "currency"
        ? formatCurrencyShort(delta)
        : formatInteger(delta);

  return (
    <td className="border-r border-[#edf0f4] px-2 py-2.5 text-right last:border-r-0">
      <div className="font-semibold text-[#24272d]">{value}</div>
      <div className={`mt-0.5 text-[11px] ${deltaTextClassName(delta)}`}>
        {changeLabel} {formattedDelta}
      </div>
    </td>
  );
}

function MoMPercentCell({ value }: { value: number | null }) {
  return (
    <td
      className={`border-r border-[#edf0f4] px-2 py-3 text-right last:border-r-0 ${salesMomHeatmapClassName(
        value
      )}`}
    >
      {formatNullablePercent(value)}
    </td>
  );
}

function CarrierDashboardOverview({ rows }: { rows: CarrierSummary[] }) {
  const maxes = buildOverviewMaxes(rows);

  return (
    <ReportPanel title="Carrier Performance">
      <div
        className="max-h-[520px] overflow-y-auto overflow-x-hidden"
        style={{ scrollbarGutter: "stable" }}
      >
        <table className="w-full table-fixed text-[11px] tabular-nums">
          <colgroup>
            <col style={{ width: "31%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "23%" }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <OverviewHeaderCell>Company</OverviewHeaderCell>
              <OverviewHeaderCell align="right" tone="green">
                Policies
              </OverviewHeaderCell>
              <OverviewHeaderCell align="right" tone="green">
                Share
              </OverviewHeaderCell>
              <OverviewHeaderCell align="right" tone="amber">
                Premium
              </OverviewHeaderCell>
              <OverviewHeaderCell align="right" tone="blue">
                Agent Comm
              </OverviewHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}
                key={row.company}
              >
                <OverviewNameCell>{row.company}</OverviewNameCell>
                <OverviewHeatCell
                  maxValue={maxes.policyCount}
                  mode="green"
                  value={row.policyCount}
                >
                  {formatInteger(row.policyCount)}
                </OverviewHeatCell>
                <OverviewHeatCell
                  maxValue={maxes.policySharePercent}
                  mode="green"
                  value={row.policySharePercent}
                >
                  {formatPercent(row.policySharePercent)}
                </OverviewHeatCell>
                <OverviewHeatCell
                  maxValue={maxes.totalPremium}
                  mode="amber"
                  value={row.totalPremium}
                >
                  {formatCurrency(row.totalPremium)}
                </OverviewHeatCell>
                <OverviewHeatCell
                  maxValue={maxes.agentCommission}
                  mode="blue"
                  value={row.agentCommission}
                >
                  {formatCurrency(row.agentCommission)}
                </OverviewHeatCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function StateCityPerformanceTable({ groups }: { groups: StateGroup[] }) {
  const cityRows = groups
    .flatMap((group) => group.rows.filter((row) => !row.isTotal))
    .sort(
      (left, right) =>
        right.policyCount - left.policyCount ||
        right.totalPremium - left.totalPremium ||
        left.state.localeCompare(right.state) ||
        left.city.localeCompare(right.city)
    );
  const maxes = {
    agentCommission: maxValue(cityRows, (row) => row.agentCommission),
    policyCount: maxValue(cityRows, (row) => row.policyCount),
    policySharePercent: maxValue(cityRows, (row) => row.policySharePercent),
    totalPremium: maxValue(cityRows, (row) => row.totalPremium),
  };

  return (
    <ReportPanel title="State & City Performance">
      <div
        className="max-h-[520px] overflow-y-auto overflow-x-hidden"
        style={{ scrollbarGutter: "stable" }}
      >
        <table className="w-full table-fixed text-[11px] tabular-nums">
          <colgroup>
            <col style={{ width: "12%" }} />
            <col style={{ width: "28%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "17%" }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <OverviewHeaderCell>State</OverviewHeaderCell>
              <OverviewHeaderCell>City</OverviewHeaderCell>
              <OverviewHeaderCell align="right" tone="green">
                Policies
              </OverviewHeaderCell>
              <OverviewHeaderCell align="right" tone="green">
                Share
              </OverviewHeaderCell>
              <OverviewHeaderCell align="right" tone="amber">
                Premium
              </OverviewHeaderCell>
              <OverviewHeaderCell align="right" tone="blue">
                Agent Comm
              </OverviewHeaderCell>
            </tr>
          </thead>
          <tbody>
            {cityRows.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-sm text-slate-500"
                  colSpan={6}
                >
                  No state or city data.
                </td>
              </tr>
            ) : (
              cityRows.map((row, index) => (
                <tr
                  className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}
                  key={`${row.state}-${row.city}-${index}`}
                >
                  <OverviewNameCell>{row.state}</OverviewNameCell>
                  <OverviewNameCell>{row.city}</OverviewNameCell>
                  <OverviewHeatCell
                    maxValue={maxes.policyCount}
                    mode="green"
                    value={row.policyCount}
                  >
                    {formatInteger(row.policyCount)}
                  </OverviewHeatCell>
                  <OverviewHeatCell
                    maxValue={maxes.policySharePercent}
                    mode="green"
                    value={row.policySharePercent}
                  >
                    {formatPercent(row.policySharePercent)}
                  </OverviewHeatCell>
                  <OverviewHeatCell
                    maxValue={maxes.totalPremium}
                    mode="amber"
                    value={row.totalPremium}
                  >
                    {formatCurrency(row.totalPremium)}
                  </OverviewHeatCell>
                  <OverviewHeatCell
                    maxValue={maxes.agentCommission}
                    mode="blue"
                    value={row.agentCommission}
                  >
                    {formatCurrency(row.agentCommission)}
                  </OverviewHeatCell>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function OverviewHeaderCell({
  align = "left",
  children,
  tone = "base",
}: {
  align?: "left" | "right";
  children: ReactNode;
  tone?: "amber" | "base" | "blue" | "green" | "lavender";
}) {
  return (
    <th
      className={`border-r border-b border-slate-200 px-2.5 py-3.5 align-middle text-[10px] font-semibold uppercase leading-snug tracking-[0.08em] whitespace-nowrap last:border-r-0 ${overviewHeaderToneClassName(
        tone
      )} ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function OverviewNameCell({ children }: { children: ReactNode }) {
  return (
    <td className="border-r border-b border-slate-100 bg-slate-50/40 px-2.5 py-3.5 align-middle text-[13px] font-semibold leading-snug text-slate-900 last:border-r-0">
      <div
        className="line-clamp-2 break-words"
        title={typeof children === "string" ? children : undefined}
      >
        {children}
      </div>
    </td>
  );
}

function OverviewHeatCell({
  children,
  maxValue,
  mode,
  value,
}: {
  children: ReactNode;
  maxValue: number;
  mode: "amber" | "blue" | "green" | "lavender";
  value: number;
}) {
  return (
    <td
      className="border-r border-b border-slate-100 px-2 py-3.5 text-right text-[12px] whitespace-nowrap text-slate-700 last:border-r-0"
      style={{ backgroundColor: overviewHeatColor(value, maxValue, mode) }}
    >
      {children}
    </td>
  );
}

function PolicyDetailsTable({
  rows,
  showAgent,
}: {
  rows: PolicyDetailRow[];
  showAgent: boolean;
}) {
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [insuredFilter, setInsuredFilter] = useState<string[]>([]);
  const [policyFilter, setPolicyFilter] = useState<string[]>([]);
  const [carrierFilter, setCarrierFilter] = useState<string[]>([]);
  const [agencyFilter, setAgencyFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [effectiveDateRange, setEffectiveDateRange] = useState<DateRange | null>(null);
  const [expiredDateRange, setExpiredDateRange] = useState<DateRange | null>(null);
  const [sortState, setPolicySortState] = useState<PolicySortState | null>(null);
  const [activePanel, setActivePanel] = useState<PolicySortKey | null>(null);

  const agentOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.agent)), [rows]);
  const insuredOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.insuredName)), [rows]);
  const policyOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.policyNumber)), [rows]);
  const carrierOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.carrier)), [rows]);
  const agencyOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.agency)), [rows]);
  const statusOptions = useMemo(() => getPolicyFilterOptions(rows.map((r) => r.status)), [rows]);

  const hasActiveFilters =
    agentFilter.length > 0 ||
    insuredFilter.length > 0 ||
    policyFilter.length > 0 ||
    carrierFilter.length > 0 ||
    agencyFilter.length > 0 ||
    statusFilter.length > 0 ||
    effectiveDateRange !== null ||
    expiredDateRange !== null ||
    Boolean(sortState);

  const filteredRows = useMemo(() => {
    const result = rows.filter((row) => {
      if (agentFilter.length > 0 && !agentFilter.includes(row.agent)) return false;
      if (insuredFilter.length > 0 && !insuredFilter.includes(row.insuredName)) return false;
      if (policyFilter.length > 0 && !policyFilter.includes(row.policyNumber)) return false;
      if (carrierFilter.length > 0 && !carrierFilter.includes(row.carrier)) return false;
      if (agencyFilter.length > 0 && !agencyFilter.includes(row.agency)) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(row.status)) return false;
      if (effectiveDateRange) {
        const d = row.effectiveDate ?? "";
        if (effectiveDateRange.from && d < effectiveDateRange.from) return false;
        if (effectiveDateRange.to && d > effectiveDateRange.to) return false;
      }
      if (expiredDateRange) {
        const d = row.expiredDate ?? "";
        if (expiredDateRange.from && d < expiredDateRange.from) return false;
        if (expiredDateRange.to && d > expiredDateRange.to) return false;
      }
      return true;
    });

    if (sortState) {
      result.sort((a, b) => {
        const aVal = getPolicySortValue(a, sortState.key);
        const bVal = getPolicySortValue(b, sortState.key);
        const mult = sortState.direction === "asc" ? 1 : -1;
        if (typeof aVal === "number" && typeof bVal === "number") return (aVal - bVal) * mult;
        return String(aVal).localeCompare(String(bVal)) * mult;
      });
    }

    return result;
  }, [rows, agentFilter, insuredFilter, policyFilter, carrierFilter, agencyFilter, statusFilter, effectiveDateRange, expiredDateRange, sortState]);

  useEffect(() => {
    if (!activePanel) return;

    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-pc-policy-filter]")) return;
      setActivePanel(null);
    }

    function closeEsc(event: KeyboardEvent) {
      if (event.key === "Escape") setActivePanel(null);
    }

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEsc);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEsc);
    };
  }, [activePanel]);

  function toggle(key: PolicySortKey) {
    setActivePanel((cur) => (cur === key ? null : key));
  }

  function doSort(key: PolicySortKey, dir: SortDirection) {
    setPolicySortState({ key, direction: dir });
    setActivePanel(null);
  }

  function clearAll() {
    setAgentFilter([]);
    setInsuredFilter([]);
    setPolicyFilter([]);
    setCarrierFilter([]);
    setAgencyFilter([]);
    setStatusFilter([]);
    setEffectiveDateRange(null);
    setExpiredDateRange(null);
    setPolicySortState(null);
    setActivePanel(null);
  }

  function exportFilteredRows() {
    exportPolicyDetailsRows(filteredRows, showAgent);
  }

  return (
    <ReportPanel title="Policy Detail">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-xs text-slate-500">
          Showing {formatInteger(filteredRows.length)} of {formatInteger(rows.length)} policies
        </p>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd7e3] bg-white px-3 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={filteredRows.length === 0}
            onClick={exportFilteredRows}
            type="button"
          >
            <FileDown aria-hidden="true" size={14} strokeWidth={2.2} />
            Export XLSX
          </button>
          <button
            className="h-8 rounded-md border border-[#cfd7e3] bg-white px-3 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasActiveFilters}
            onClick={clearAll}
            type="button"
          >
            Clear Filters
          </button>
        </div>
      </div>
      <div className="overflow-auto" style={{ maxHeight: POLICY_DETAIL_TABLE_MAX_HEIGHT }}>
        <table className="text-[12px] tabular-nums">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="border-r border-b border-slate-200 bg-slate-50 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap" style={{ width: 44 }}>
                #
              </th>
              {showAgent ? (
                <HeaderCell width={100}>
                  <PolicyFilterableHeader
                    active={agentFilter.length > 0 || sortState?.key === "agent"}
                    isOpen={activePanel === "agent"}
                    label="Agent"
                    onToggle={() => toggle("agent")}
                  >
                    <PolicyExcelFilterPanel
                      label="Agent"
                      options={agentOptions}
                      selectedValues={agentFilter}
                      onApply={setAgentFilter}
                      onCancel={() => setActivePanel(null)}
                      onClearFilter={() => setAgentFilter([])}
                      onSort={(d) => doSort("agent", d)}
                    />
                  </PolicyFilterableHeader>
                </HeaderCell>
              ) : null}
              <HeaderCell width={170}>
                <PolicyFilterableHeader
                  active={insuredFilter.length > 0 || sortState?.key === "insuredName"}
                  isOpen={activePanel === "insuredName"}
                  label="Insured"
                  onToggle={() => toggle("insuredName")}
                >
                  <PolicyExcelFilterPanel
                    label="Insured"
                    options={insuredOptions}
                    selectedValues={insuredFilter}
                    onApply={setInsuredFilter}
                    onCancel={() => setActivePanel(null)}
                    onClearFilter={() => setInsuredFilter([])}
                    onSort={(d) => doSort("insuredName", d)}
                  />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={130}>
                <PolicyFilterableHeader
                  active={policyFilter.length > 0 || sortState?.key === "policyNumber"}
                  isOpen={activePanel === "policyNumber"}
                  label="Policy"
                  onToggle={() => toggle("policyNumber")}
                >
                  <PolicyExcelFilterPanel
                    label="Policy"
                    options={policyOptions}
                    selectedValues={policyFilter}
                    onApply={setPolicyFilter}
                    onCancel={() => setActivePanel(null)}
                    onClearFilter={() => setPolicyFilter([])}
                    onSort={(d) => doSort("policyNumber", d)}
                  />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={120}>
                <PolicyFilterableHeader
                  active={carrierFilter.length > 0 || sortState?.key === "carrier"}
                  isOpen={activePanel === "carrier"}
                  label="Carrier"
                  onToggle={() => toggle("carrier")}
                >
                  <PolicyExcelFilterPanel
                    label="Carrier"
                    options={carrierOptions}
                    selectedValues={carrierFilter}
                    onApply={setCarrierFilter}
                    onCancel={() => setActivePanel(null)}
                    onClearFilter={() => setCarrierFilter([])}
                    onSort={(d) => doSort("carrier", d)}
                  />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={110}>
                <PolicyFilterableHeader
                  active={agencyFilter.length > 0 || sortState?.key === "agency"}
                  isOpen={activePanel === "agency"}
                  label="Agency"
                  onToggle={() => toggle("agency")}
                >
                  <PolicyExcelFilterPanel
                    label="Agency"
                    options={agencyOptions}
                    selectedValues={agencyFilter}
                    onApply={setAgencyFilter}
                    onCancel={() => setActivePanel(null)}
                    onClearFilter={() => setAgencyFilter([])}
                    onSort={(d) => doSort("agency", d)}
                  />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell align="right" width={115}>
                <PolicyFilterableHeader
                  active={sortState?.key === "premium"}
                  align="right"
                  isOpen={activePanel === "premium"}
                  label="Premium"
                  onToggle={() => toggle("premium")}
                >
                  <PolicyExcelFilterPanel
                    label="Premium"
                    options={[]}
                    selectedValues={[]}
                    onApply={() => {}}
                    onCancel={() => setActivePanel(null)}
                    onClearFilter={() => {}}
                    onSort={(d) => doSort("premium", d)}
                    sortAscLabel="Sort smallest to largest"
                    sortDescLabel="Sort largest to smallest"
                  />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell align="right" width={155}>
                <PolicyFilterableHeader
                  active={sortState?.key === "agentCommission"}
                  align="right"
                  isOpen={activePanel === "agentCommission"}
                  label="Agent Commission"
                  onToggle={() => toggle("agentCommission")}
                >
                  <PolicyExcelFilterPanel
                    label="Agent Commission"
                    options={[]}
                    selectedValues={[]}
                    onApply={() => {}}
                    onCancel={() => setActivePanel(null)}
                    onClearFilter={() => {}}
                    onSort={(d) => doSort("agentCommission", d)}
                    sortAscLabel="Sort smallest to largest"
                    sortDescLabel="Sort largest to smallest"
                  />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={110}>
                <PolicyFilterableHeader
                  active={effectiveDateRange !== null || sortState?.key === "effectiveDate"}
                  align="right"
                  isOpen={activePanel === "effectiveDate"}
                  label="Effective"
                  onToggle={() => toggle("effectiveDate")}
                >
                  <PolicyDateFilterPanel
                    onApply={setEffectiveDateRange}
                    onCancel={() => setActivePanel(null)}
                    onClear={() => setEffectiveDateRange(null)}
                    onSort={(d) => doSort("effectiveDate", d)}
                    presets={effectiveDatePresets()}
                    value={effectiveDateRange}
                  />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={110}>
                <PolicyFilterableHeader
                  active={expiredDateRange !== null || sortState?.key === "expiredDate"}
                  align="right"
                  isOpen={activePanel === "expiredDate"}
                  label="Expired"
                  onToggle={() => toggle("expiredDate")}
                >
                  <PolicyDateFilterPanel
                    onApply={setExpiredDateRange}
                    onCancel={() => setActivePanel(null)}
                    onClear={() => setExpiredDateRange(null)}
                    onSort={(d) => doSort("expiredDate", d)}
                    presets={expiredDatePresets()}
                    value={expiredDateRange}
                  />
                </PolicyFilterableHeader>
              </HeaderCell>
              <HeaderCell width={100}>
                <PolicyFilterableHeader
                  active={statusFilter.length > 0 || sortState?.key === "status"}
                  align="right"
                  isOpen={activePanel === "status"}
                  label="Status"
                  onToggle={() => toggle("status")}
                >
                  <PolicyExcelFilterPanel
                    label="Status"
                    options={statusOptions}
                    selectedValues={statusFilter}
                    onApply={setStatusFilter}
                    onCancel={() => setActivePanel(null)}
                    onClearFilter={() => setStatusFilter([])}
                    onSort={(d) => doSort("status", d)}
                  />
                </PolicyFilterableHeader>
              </HeaderCell>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-slate-500" colSpan={showAgent ? 11 : 10}>
                  No policies matched these filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => (
                <tr
                  className={index % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}
                  key={`${row.policyNumber}-${row.effectiveDate}-${index}`}
                >
                  <td className="border-r border-b border-slate-100 px-3 py-3 text-right text-xs font-semibold text-slate-400 whitespace-nowrap">
                    {index + 1}
                  </td>
                  {showAgent ? <BodyCell>{row.agent}</BodyCell> : null}
                  <BodyCell strong>{row.insuredName || "-"}</BodyCell>
                  <BodyCell>{row.policyNumber || "-"}</BodyCell>
                  <BodyCell>{row.carrier}</BodyCell>
                  <BodyCell>{row.agency}</BodyCell>
                  <BodyCell align="right">{formatCurrencyShort(row.premium)}</BodyCell>
                  <BodyCell align="right">{formatCurrencyShort(row.agentCommission)}</BodyCell>
                  <BodyCell>{formatDate(row.effectiveDate)}</BodyCell>
                  <BodyCell>{formatDate(row.expiredDate)}</BodyCell>
                  <BodyCell>{row.status}</BodyCell>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  );
}

function exportPolicyDetailsRows(rows: PolicyDetailRow[], showAgent: boolean) {
  const headers = [
    "#",
    ...(showAgent ? ["Agent"] : []),
    "Insured",
    "Policy",
    "Carrier",
    "Agency",
    "Premium",
    "Agent Commission",
    "Effective Date",
    "Expired Date",
    "Status",
  ];
  const exportRows = rows.map((row, index) => [
    index + 1,
    ...(showAgent ? [row.agent] : []),
    row.insuredName,
    row.policyNumber,
    row.carrier,
    row.agency,
    row.premium,
    row.agentCommission,
    row.effectiveDate ?? "",
    row.expiredDate ?? "",
    row.status,
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...exportRows]);

  sheet["!cols"] = headers.map((header) => ({
    wch: getPolicyDetailExportColumnWidth(header),
  }));
  applyPolicyDetailExportFormats(sheet, headers, exportRows.length);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Policy Detail");
  XLSX.writeFile(
    workbook,
    `pc-policy-detail-${new Date().toISOString().slice(0, 10)}.xlsx`,
    { compression: true }
  );
}

function getPolicyDetailExportColumnWidth(header: string) {
  if (header === "#") return 8;
  if (header === "Insured") return 28;
  if (header === "Policy") return 22;
  if (header === "Premium") return 16;
  if (header === "Agent Commission") return 18;
  if (header.endsWith("Date")) return 16;
  if (header === "Carrier") return 22;
  return 14;
}

function applyPolicyDetailExportFormats(
  sheet: XLSX.WorkSheet,
  headers: string[],
  rowCount: number
) {
  const currencyColumnIndexes = headers.reduce<number[]>(
    (indexes, header, index) => {
      if (header === "Premium" || header === "Agent Commission") {
        indexes.push(index);
      }

      return indexes;
    },
    []
  );

  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    for (const columnIndex of currencyColumnIndexes) {
      const cellAddress = XLSX.utils.encode_cell({
        c: columnIndex,
        r: rowIndex,
      });
      const cell = sheet[cellAddress];

      if (cell && cell.t === "n") {
        cell.z = "$#,##0.00";
      }
    }
  }
}

function ReportPanel({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold leading-tight text-slate-800">
          {title}
        </h3>
      </div>
      <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        {children}
      </div>
    </section>
  );
}

function PolicyFilterableHeader({
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
    <div className="relative" data-pc-policy-filter>
      <div className="flex items-center gap-1">
        <span className="whitespace-nowrap">{label}</span>
        <button
          aria-label={`Filter ${label}`}
          aria-pressed={active}
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition hover:bg-[#e9eef6] hover:text-[#184e8a] ${active ? "bg-[#dbeafe] text-[#184e8a]" : "text-slate-400"}`}
          onClick={onToggle}
          type="button"
        >
          <Filter aria-hidden="true" size={12} strokeWidth={2.4} />
        </button>
      </div>
      {isOpen ? (
        <div
          className={`absolute top-full z-50 mt-2 w-72 rounded-lg border border-[#cfd7e3] bg-white p-3 text-left text-sm normal-case font-normal tracking-normal text-[#16233a] shadow-xl ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function PolicyExcelFilterPanel({
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
  options: PolicyFilterOption[];
  selectedValues: string[];
  sortAscLabel?: string;
  sortDescLabel?: string;
}) {
  const optionValues = useMemo(() => options.map((o) => o.value), [options]);
  const [searchValue, setSearchValue] = useState("");
  const [draftValues, setDraftValues] = useState<string[]>(
    selectedValues.length > 0 ? selectedValues : optionValues
  );
  const draftValueSet = useMemo(() => new Set(draftValues), [draftValues]);
  const visibleOptions = useMemo(() => {
    const search = searchValue.trim().toLowerCase();
    if (!search) return options;
    return options.filter((o) => o.label.toLowerCase().includes(search));
  }, [options, searchValue]);
  const selectedVisibleCount = visibleOptions.reduce(
    (n, o) => n + (draftValueSet.has(o.value) ? 1 : 0),
    0
  );
  const areAllVisibleSelected =
    visibleOptions.length > 0 && selectedVisibleCount === visibleOptions.length;

  function toggleValue(value: string) {
    setDraftValues((cur) => {
      const next = new Set(cur);
      next.has(value) ? next.delete(value) : next.add(value);
      return [...next];
    });
  }

  function toggleVisible() {
    const visibleVals = visibleOptions.map((o) => o.value);
    const visibleSet = new Set(visibleVals);
    setDraftValues((cur) =>
      areAllVisibleSelected
        ? cur.filter((v) => !visibleSet.has(v))
        : [...new Set([...cur, ...visibleVals])]
    );
  }

  function clearFilter() {
    setDraftValues(optionValues);
    onClearFilter();
    onCancel();
  }

  function apply() {
    onApply(
      draftValues.length === optionValues.length
        ? []
        : [...draftValues].sort((a, b) => a.localeCompare(b))
    );
    onCancel();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1 border-b border-[#edf0f4] pb-2">
        <button
          className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]"
          onClick={() => onSort("asc")}
          type="button"
        >
          {sortAscLabel}
        </button>
        <button
          className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]"
          onClick={() => onSort("desc")}
          type="button"
        >
          {sortDescLabel}
        </button>
      </div>
      {options.length > 0 ? (
        <>
          <div className="flex items-center gap-2 text-xs">
            <button
              className="font-semibold text-[#184e8a] hover:underline"
              onClick={() => setDraftValues(optionValues)}
              type="button"
            >
              Select all
            </button>
            <button
              className="font-semibold text-[#184e8a] hover:underline"
              onClick={clearFilter}
              type="button"
            >
              Clear filter
            </button>
            <span className="ml-auto text-[#667085]">
              {visibleOptions.length} items
            </span>
          </div>
          <label className="block">
            <span className="sr-only">Search {label}</span>
            <input
              className="h-9 w-full rounded-md border border-[#cfd7e3] bg-white px-3 text-sm font-normal text-[#16233a] outline-none transition focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/10"
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search values"
              type="search"
              value={searchValue}
            />
          </label>
          <div className="max-h-44 overflow-auto border-y border-[#edf0f4] py-1">
            {visibleOptions.length === 0 ? (
              <div className="px-2 py-3 text-sm text-[#667085]">No values found.</div>
            ) : (
              <>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]">
                  <input
                    checked={areAllVisibleSelected}
                    className="h-4 w-4 rounded border-[#cfd7e3] text-[#184e8a] focus:ring-[#184e8a]"
                    onChange={toggleVisible}
                    type="checkbox"
                  />
                  <span>(Select visible)</span>
                </label>
                {visibleOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]"
                  >
                    <input
                      checked={draftValueSet.has(option.value)}
                      className="h-4 w-4 rounded border-[#cfd7e3] text-[#184e8a] focus:ring-[#184e8a]"
                      onChange={() => toggleValue(option.value)}
                      type="checkbox"
                    />
                    <span className="truncate" title={option.label}>{option.label}</span>
                  </label>
                ))}
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              className="h-9 rounded-md border border-[#cfd7e3] bg-white px-4 text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-9 rounded-md bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#166534] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
              disabled={draftValues.length === 0}
              onClick={apply}
              type="button"
            >
              OK
            </button>
          </div>
        </>
      ) : (
        <div className="flex justify-end pt-1">
          <button
            className="h-9 rounded-md border border-[#cfd7e3] bg-white px-4 text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function getPolicyFilterOptions(values: string[]): PolicyFilterOption[] {
  return [...new Set(values)]
    .sort((a, b) => (a || "").localeCompare(b || ""))
    .map((value) => ({ label: value || "(Blank)", value }));
}

function PolicyDateFilterPanel({
  onApply,
  onCancel,
  onClear,
  onSort,
  presets,
  value,
}: {
  onApply: (range: DateRange | null) => void;
  onCancel: () => void;
  onClear: () => void;
  onSort: (direction: SortDirection) => void;
  presets: { label: string; from: string; to: string }[];
  value: DateRange | null;
}) {
  const [from, setFrom] = useState(value?.from ?? "");
  const [to, setTo] = useState(value?.to ?? "");

  function applyPreset(preset: { from: string; to: string }) {
    setFrom(preset.from);
    setTo(preset.to);
  }

  function apply() {
    onApply(from || to ? { from, to } : null);
    onCancel();
  }

  function clear() {
    setFrom("");
    setTo("");
    onClear();
    onCancel();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1 border-b border-[#edf0f4] pb-2">
        <button
          className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]"
          onClick={() => onSort("asc")}
          type="button"
        >
          Sort oldest to newest
        </button>
        <button
          className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]"
          onClick={() => onSort("desc")}
          type="button"
        >
          Sort newest to oldest
        </button>
      </div>
      {presets.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#667085]">
            Quick select
          </p>
          {presets.map((preset) => (
            <button
              key={preset.label}
              className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#344054] transition hover:bg-[#f3f6fa]"
              onClick={() => applyPreset(preset)}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#667085]">
          Date range
        </p>
        <div className="space-y-1.5">
          <input
            className="block h-8 w-full min-w-0 rounded-md border border-[#cfd7e3] bg-white px-2 text-sm text-[#16233a] outline-none transition focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/10"
            onChange={(e) => setFrom(e.target.value)}
            placeholder="From"
            type="date"
            value={from}
          />
          <input
            className="block h-8 w-full min-w-0 rounded-md border border-[#cfd7e3] bg-white px-2 text-sm text-[#16233a] outline-none transition focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/10"
            onChange={(e) => setTo(e.target.value)}
            placeholder="To"
            type="date"
            value={to}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          className="text-xs font-semibold text-[#184e8a] hover:underline"
          onClick={clear}
          type="button"
        >
          Clear
        </button>
        <div className="flex gap-2">
          <button
            className="h-8 rounded-md border border-[#cfd7e3] bg-white px-3 text-sm font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-8 rounded-md bg-[#15803d] px-3 text-sm font-semibold text-white transition hover:bg-[#166534]"
            onClick={apply}
            type="button"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function effectiveDatePresets() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");

  return [
    { label: "This month", from: `${y}-${m}-01`, to: toISODate(new Date(y, today.getMonth() + 1, 0)) },
    { label: "Last 3 months", from: toISODate(addDays(today, -90)), to: toISODate(today) },
    { label: "This year", from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}

function expiredDatePresets() {
  const today = new Date();

  return [
    { label: "Already expired", from: "", to: toISODate(addDays(today, -1)) },
    { label: "Next 30 days", from: toISODate(today), to: toISODate(addDays(today, 30)) },
    { label: "Next 60 days", from: toISODate(today), to: toISODate(addDays(today, 60)) },
    { label: "Next 90 days", from: toISODate(today), to: toISODate(addDays(today, 90)) },
  ];
}

function getPolicySortValue(row: PolicyDetailRow, key: PolicySortKey): string | number {
  if (key === "agent") return row.agent;
  if (key === "insuredName") return row.insuredName;
  if (key === "policyNumber") return row.policyNumber;
  if (key === "carrier") return row.carrier;
  if (key === "agency") return row.agency;
  if (key === "premium") return row.premium;
  if (key === "agentCommission") return row.agentCommission;
  if (key === "effectiveDate") return row.effectiveDate ?? "";
  if (key === "expiredDate") return row.expiredDate ?? "";
  return row.status;
}

function HeaderCell({
  align = "left",
  children,
  width,
}: {
  align?: "left" | "right";
  children: ReactNode;
  width: number;
}) {
  return (
    <th
      className={`whitespace-nowrap border-r border-b border-slate-200 bg-slate-50 px-3 py-3 align-middle text-[11px] font-semibold uppercase tracking-wider text-slate-500 last:border-r-0 ${
        align === "right" ? "text-right" : "text-left"
      }`}
      style={{ width }}
    >
      {children}
    </th>
  );
}

function BodyCell({
  align = "left",
  children,
  strong = false,
}: {
  align?: "left" | "right";
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      className={`border-r border-b border-slate-100 px-3 py-3 align-middle text-sm text-slate-700 last:border-r-0 ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-semibold text-slate-900" : ""}`}
    >
      {children}
    </td>
  );
}

function KpiCard({
  compact = false,
  label,
  muted = false,
  value,
}: {
  compact?: boolean;
  label: string;
  muted?: boolean;
  value: string;
}) {
  return (
    <article
      className={`flex flex-col rounded-xl border border-slate-200/70 bg-white text-center shadow-[0_6px_18px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.1)] ${
        compact ? "min-h-[112px] px-4 py-4" : "min-h-[124px] px-5 py-4"
      }`}
    >
      <div
        className={`flex min-h-8 items-center justify-center text-[12px] font-semibold uppercase leading-snug tracking-[0.08em] ${
          muted ? "text-slate-400" : "text-slate-500"
        }`}
      >
        {label}
      </div>
      <div className="flex flex-1 items-center justify-center py-2">
        <div
          className={`w-full break-words text-center font-bold leading-none tracking-normal tabular-nums ${
            compact ? "text-[1.75rem] text-slate-900" : "text-[2rem] text-slate-950"
          }`}
        >
          {value}
        </div>
      </div>
    </article>
  );
}

function buildDashboardData(rows: AgentPcRow[]): DashboardData {
  const overview = summarizeRows(rows);
  const stateGroups = buildStateGroups(rows, overview);
  const periodsByLevel = {
    month: buildPeriodSummaries(rows, "month"),
    quarter: buildPeriodSummaries(rows, "quarter"),
    year: buildPeriodSummaries(rows, "year"),
  };

  return {
    carrierRows: buildCarrierRows(rows, overview),
    stateGroups,
    statePolicyCounts: buildStatePolicyCounts(stateGroups),
    growthRowsByLevel: {
      month: buildPeriodGrowthRows(rows, "month"),
      quarter: buildPeriodGrowthRows(rows, "quarter"),
      year: buildPeriodGrowthRows(rows, "year"),
    },
    overview,
    periodsByLevel,
    policyDetailRows: buildPolicyDetailRows(rows),
  };
}

function applyClientFilters(rows: AgentPcRow[], filters: AgentPcFilterValues) {
  const policyNumber = filters.policyNumber.trim().toUpperCase();

  return rows.filter((row) => {
    if (filters.agency && cleanGroupLabel(row.agency_name) !== filters.agency) {
      return false;
    }

    if (
      policyNumber &&
      !cleanText(row.policy_number).toUpperCase().includes(policyNumber)
    ) {
      return false;
    }

    return true;
  });
}

function syncClientFilterUrl(filters: AgentPcFilterValues) {
  const params = new URLSearchParams(window.location.search);

  params.delete("agency");
  params.delete("agent");
  params.delete("company");
  params.delete("policyNumber");

  if (filters.agency) params.set("agency", filters.agency);
  if (filters.policyNumber) params.set("policyNumber", filters.policyNumber);

  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    query ? `${window.location.pathname}?${query}` : window.location.pathname
  );
}

function summarizeRows(rows: AgentPcRow[]): Summary {
  const currentDate = new Date();
  const policies = new Map<
    string,
    {
      active: boolean;
      renewal: boolean;
      positivePremium: boolean;
    }
  >();
  let totalPremium = 0;
  let agentCommission = 0;

  rows.forEach((row, index) => {
    const premium = Math.max(moneyValue(row.true_premium ?? row.premium), 0);
    const isPositivePolicy = premium > 0;
    const policyId = getPolicyId(row, index);
    const current = policies.get(policyId) ?? {
      active: false,
      positivePremium: false,
      renewal: false,
    };
    const expiredDate = toDate(row.expired_date);
    const isActivePolicy =
      isPositivePolicy && expiredDate !== null && expiredDate >= currentDate;

    current.active = current.active || isActivePolicy;
    current.positivePremium = current.positivePremium || isPositivePolicy;
    current.renewal = current.renewal || cleanGroupLabel(row.status) === "RENEWAL";
    policies.set(policyId, current);

    totalPremium += premium;
    agentCommission += moneyValue(row.agent_commission_amount);
  });
  const policyValues = [...policies.values()].filter(
    (policy) => policy.positivePremium
  );

  return {
    activePolicyCount: policyValues.filter((policy) => policy.active).length,
    agentCommission,
    policyCount: policyValues.length,
    renewalPolicyCount: policyValues.filter((policy) => policy.renewal).length,
    totalPremium,
  };
}

function buildPeriodSummaries(
  rows: AgentPcRow[],
  trendLevel: TrendLevel
): PeriodSummary[] {
  return [
    ...groupRows(rows, (row) =>
      getTrendPeriodKey(getEffectiveMonth(row), trendLevel)
    ).entries(),
  ]
    .filter(([periodKey]) => Boolean(periodKey))
    .map(([periodKey, group]) => ({
      periodKey,
      periodLabel: formatTrendPeriodLabel(periodKey, trendLevel),
      ...summarizeRows(group),
    }))
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
    .slice(0, TREND_LIMIT_BY_LEVEL[trendLevel])
    .reverse();
}

function buildPeriodGrowthRows(
  rows: AgentPcRow[],
  trendLevel: TrendLevel
): PeriodGrowthRow[] {
  const chronological = [
    ...groupRows(rows, (row) =>
      getTrendPeriodKey(getEffectiveMonth(row), trendLevel)
    ).entries(),
  ]
    .filter(([periodKey]) => Boolean(periodKey))
    .map(([periodKey, group]) => ({
      periodKey,
      periodLabel: formatTrendPeriodLabel(periodKey, trendLevel),
      ...summarizeRows(group),
    }))
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey));

  return chronological
    .map<PeriodGrowthRow>((row, index) => {
      const previous = chronological[index - 1] ?? null;
      const policyChange = previous ? row.policyCount - previous.policyCount : null;
      const premiumChange = previous
        ? row.totalPremium - previous.totalPremium
        : null;
      const agentCommissionChange = previous
        ? row.agentCommission - previous.agentCommission
        : null;

      return {
        ...row,
        agentCommissionChange,
        agentCommissionChangePercent: calculateChangePercent(
          agentCommissionChange,
          previous?.agentCommission ?? null
        ),
        policyChange,
        policyChangePercent: calculateChangePercent(
          policyChange,
          previous?.policyCount ?? null
        ),
        premiumChange,
        premiumChangePercent: calculateChangePercent(
          premiumChange,
          previous?.totalPremium ?? null
        ),
      };
    })
    .reverse();
}

function buildStateGroups(
  rows: AgentPcRow[],
  overview: Summary
): StateGroup[] {
  const byState = groupRows(rows, (row) => cleanGroupLabel(row.state));

  return [...byState.entries()]
    .filter(([state]) => state !== "null")
    .map(([state, stateRows]) => {
      const cityRows = [
        ...groupRows(stateRows, (row) => cleanGroupLabel(row.city)).entries(),
      ]
        .map(([city, group]) => {
          const summary = summarizeRows(group);

          return {
            ...summary,
            state,
            city: city === "null" ? "Unknown" : city,
            isTotal: false,
            policySharePercent: percentOf(
              summary.policyCount,
              overview.policyCount
            ),
          };
        })
        .sort(
          (a, b) => b.policyCount - a.policyCount || a.city.localeCompare(b.city)
        );

      const stateSummary = summarizeRows(stateRows);
      const totalRow: StateCityRow = {
        ...stateSummary,
        state,
        city: "All cities",
        isTotal: true,
        policySharePercent: percentOf(
          stateSummary.policyCount,
          overview.policyCount
        ),
      };

      return { state, rows: [...cityRows, totalRow] };
    })
    .sort((a, b) => {
      const aTotal = a.rows[a.rows.length - 1].policyCount;
      const bTotal = b.rows[b.rows.length - 1].policyCount;

      return bTotal - aTotal || a.state.localeCompare(b.state);
    });
}

function buildStatePolicyCounts(groups: StateGroup[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const group of groups) {
    const totalRow = group.rows[group.rows.length - 1];
    counts[group.state] = totalRow.policyCount;
  }

  return counts;
}

function buildCarrierRows(
  rows: AgentPcRow[],
  overview: Summary
): CarrierSummary[] {
  return [...groupRows(rows, (row) => cleanGroupLabel(row.company)).entries()]
    .map(([company, group]) => {
      const summary = summarizeRows(group);

      return {
        company,
        ...summary,
        agentCommissionRate: percentOf(
          summary.agentCommission,
          summary.totalPremium
        ),
        policySharePercent: percentOf(summary.policyCount, overview.policyCount),
      };
    })
    .sort(
      (a, b) =>
        b.policyCount - a.policyCount ||
        b.totalPremium - a.totalPremium ||
        a.company.localeCompare(b.company)
    );
}

function buildExpiredMonthRows(
  rows: AgentPcRow[],
  monthKeys: string[]
): AgentPcExpiredMonthRow[] {
  const rowsByMonth = groupRows(
    rows,
    (row) => row.expired_date?.slice(0, 7) ?? ""
  );

  return monthKeys.map((monthKey) => {
    const group = rowsByMonth.get(monthKey) ?? [];

    return {
      monthKey,
      policyCount: summarizeRows(group).policyCount,
      totalPremium: group.reduce(
        (total, row) =>
          total + Math.max(moneyValue(row.true_premium ?? row.premium), 0),
        0
      ),
    };
  });
}

function buildPolicyDetailRows(rows: AgentPcRow[]): PolicyDetailRow[] {
  return [...rows]
    .filter((row) => moneyValue(row.true_premium ?? row.premium) > 0)
    .sort(
      (a, b) =>
        (b.effective_date ?? "").localeCompare(a.effective_date ?? "") ||
        cleanGroupLabel(a.company).localeCompare(cleanGroupLabel(b.company))
    )
    .map((row) => ({
      agency: cleanGroupLabel(row.agency_name),
      agent: cleanGroupLabel(row.agent_name),
      agentCommission: moneyValue(row.agent_commission_amount),
      carrier: cleanGroupLabel(row.company),
      effectiveDate: row.effective_date,
      expiredDate: row.expired_date,
      insuredName: cleanText(row.insured_name),
      policyNumber: cleanText(row.policy_number),
      premium: Math.max(moneyValue(row.true_premium ?? row.premium), 0),
      status: cleanGroupLabel(row.status),
      type: cleanGroupLabel(row.type),
    }));
}

function groupRows<T>(rows: T[], getKey: (row: T) => string) {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = getKey(row);
    const group = groups.get(key) ?? [];

    group.push(row);
    groups.set(key, group);
  }

  return groups;
}

function getPolicyId(row: AgentPcRow, index: number) {
  return cleanText(row.policy_number) || `row-${index}`;
}

function getEffectiveMonth(row: AgentPcRow) {
  return row.effective_date?.slice(0, 7) ?? "";
}

function getTrendPeriodKey(monthKey: string, trendLevel: TrendLevel) {
  if (!monthKey) return "";
  if (trendLevel === "month") return monthKey;

  const year = monthKey.slice(0, 4);

  if (trendLevel === "year") return year;

  const month = Number(monthKey.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;

  return `${year}-Q${quarter}`;
}

function formatTrendPeriodLabel(periodKey: string, trendLevel: TrendLevel) {
  if (trendLevel === "month") return formatMonthLabel(periodKey);
  if (trendLevel === "quarter") return periodKey.replace("-Q", " Q");
  return periodKey;
}

function trendLevelLabel(trendLevel: TrendLevel) {
  if (trendLevel === "quarter") return "Quarter";
  if (trendLevel === "year") return "Year";
  return "Month";
}

function getChangeLabel(trendLevel: TrendLevel) {
  if (trendLevel === "quarter") return "QoQ";
  if (trendLevel === "year") return "YoY";
  return "MoM";
}

function trendLevelAdjective(trendLevel: TrendLevel) {
  if (trendLevel === "quarter") return "Quarterly";
  if (trendLevel === "year") return "Yearly";
  return "Monthly";
}

function resolveAmountLabelY({
  barHeight,
  barY,
  lineY,
  plotBottom,
  plotTop,
}: {
  barHeight: number;
  barY: number;
  lineY: number;
  plotBottom: number;
  plotTop: number;
}) {
  const outsideY = Math.max(barY - 9, plotTop + 16);

  if (Math.abs(outsideY - lineY) >= 18) return outsideY;
  if (barHeight >= 34) return Math.min(barY + 24, plotBottom - 8);

  return Math.max(lineY + 20, plotTop + 16);
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));

  return date.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

function formatDate(value: string | null) {
  if (!value) return "-";

  const date = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
    year: "numeric",
  });
}

function cleanGroupLabel(value: string | null) {
  const cleanValue = cleanText(value);

  return cleanValue || "null";
}

function cleanText(value: string | null) {
  return value?.trim() || "";
}

function moneyValue(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function percentOf(value: number, total: number) {
  if (!total) return 0;
  return (value / total) * 100;
}

function calculateChangePercent(delta: number | null, previous: number | null) {
  if (delta === null || previous === null || previous === 0) return null;

  return (delta / previous) * 100;
}

function toDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

function maxValue<T>(rows: T[], getValue: (row: T) => number) {
  return Math.max(0, ...rows.map((row) => getValue(row)));
}

function roundAxisMax(value: number) {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;

  return Math.ceil(value / magnitude) * magnitude;
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatCurrencyShort(value: number) {
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (absValue >= 1_000_000) return `${sign}$${(absValue / 1_000_000).toFixed(2)}M`;
  if (absValue >= 1_000) return `${sign}$${(absValue / 1_000).toFixed(1)}K`;
  return `${sign}${formatCurrency(absValue)}`;
}

function formatCurrencyCompact(value: number) {
  const absValue = Math.abs(value);

  if (absValue >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (absValue >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return formatCurrency(value);
}

function formatAxisMoney(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatNullablePercent(value: number | null) {
  return value === null ? "-" : formatPercent(value);
}

function deltaTextClassName(value: number | null) {
  if (value == null || value === 0) return "text-[#667085]";
  if (value > 0) return "text-[#027a48]";
  if (value < 0) return "text-[#c01048]";

  return "text-[#667085]";
}

function salesMomHeatmapClassName(value: number | null) {
  if (value == null || value === 0) return "bg-transparent";
  return value > 0 ? "bg-[#c9e8ca]" : "bg-[#f2c5c0]";
}

function buildOverviewMaxes<
  T extends Summary & {
    agentCommissionRate: number;
    policySharePercent: number;
  },
>(rows: T[]) {
  return {
    agentCommission: maxValue(rows, (row) => row.agentCommission),
    agentCommissionRate: maxValue(rows, (row) => row.agentCommissionRate),
    policyCount: maxValue(rows, (row) => row.policyCount),
    policySharePercent: maxValue(rows, (row) => row.policySharePercent),
    totalPremium: maxValue(rows, (row) => row.totalPremium),
  };
}

function overviewHeaderToneClassName(
  tone: "amber" | "base" | "blue" | "green" | "lavender"
) {
  if (tone === "green") return "bg-[#eef8f1] text-[#285b37]";
  if (tone === "amber") return "bg-[#fff4dc] text-[#7b4a08]";
  if (tone === "blue") return "bg-[#edf6ff] text-[#234a72]";
  if (tone === "lavender") return "bg-[#f4f0ff] text-[#4b3b7a]";

  return "bg-slate-50 text-slate-600";
}

function overviewHeatColor(
  value: number,
  maxValue: number,
  mode: "amber" | "blue" | "green" | "lavender"
) {
  if (!Number.isFinite(value) || value === 0) return "transparent";

  const intensity = Math.min(Math.abs(value) / Math.max(Math.abs(maxValue), 1), 1);

  if (mode === "green") return rgba(71, 181, 82, 0.1 + intensity * 0.42);
  if (mode === "amber") return rgba(245, 158, 11, 0.1 + intensity * 0.38);
  if (mode === "blue") return rgba(73, 150, 232, 0.12 + intensity * 0.5);

  return rgba(137, 146, 204, 0.16 + intensity * 0.44);
}

function rgba(red: number, green: number, blue: number, alpha: number) {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

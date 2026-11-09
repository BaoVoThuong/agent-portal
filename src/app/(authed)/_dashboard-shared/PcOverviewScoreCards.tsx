"use client";

import { useMemo } from "react";
import {
  buildPcScoreCards,
  type PcLineSourceRow,
} from "./pc-line-of-service";
import {
  buildPcCompanyOverviewMetrics,
  buildPcOverviewMetrics,
  formatPcMetric,
  formatPcMonthKey,
  type PcCompanyOverviewPeriod,
  type PcCompanyOverviewSummary,
  type PcOverviewMetric,
  type PcOverviewMetricKey,
  type PcOverviewPeriod,
  type PcOverviewSummary,
} from "./pc-overview-metrics";
import { PcOverviewSparkline } from "./PcOverviewSparkline";

export type Hue = { text: string; mark: string };

// Màu vạch từ bảng đã kiểm của dataviz; màu chữ là bậc đậm cùng tông, >= 5:1 trên nền trắng.
export const VIOLET: Hue = { text: "#5a48c9", mark: "#6250d6" };
export const ORANGE: Hue = { text: "#b8491b", mark: "#eb6834" };
export const BLUE: Hue = { text: "#256abf", mark: "#2a78d6" };
export const AQUA: Hue = { text: "#0a7a52", mark: "#1baf7a" };
export const CRITICAL: Hue = { text: "#c23333", mark: "#d03b3b" };

const METRIC_HUES: Record<PcOverviewMetricKey, Hue> = {
  active: AQUA,
  avgComm: VIOLET,
  avgPremium: ORANGE,
  commission: VIOLET,
  commRate: VIOLET,
  policies: BLUE,
  premium: ORANGE,
  renewalRate: BLUE,
  totalCommission: BLUE,
  epsCommission: AQUA,
  totalCommRate: BLUE,
  epsCommRate: AQUA,
};
// Hàng 1 là số tiền, hàng 2 là tỉ lệ đứng thẳng dưới số gốc của nó, dải dưới là số đếm.
const AGENT_HERO_KEYS: PcOverviewMetricKey[] = ["premium", "commission", "policies", "active"];
const AGENT_RATIO_KEYS: PcOverviewMetricKey[] = ["avgPremium", "commRate", "avgComm", "renewalRate"];
const COMPANY_HERO_KEYS: PcOverviewMetricKey[] = ["premium", "totalCommission", "epsCommission", "commission"];
const COMPANY_RATIO_KEYS: PcOverviewMetricKey[] = ["avgPremium", "totalCommRate", "epsCommRate", "renewalRate"];
const COMPANY_COUNT_KEYS: PcOverviewMetricKey[] = ["policies", "active"];

export const CARD_CLASS = "rounded-xl border border-slate-200 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)]";
const LABEL_CLASS = "text-[13px] font-semibold text-slate-600";

export function PcOverviewScoreCards({
  currentMonthKey,
  overview,
  periods,
  rows,
}: {
  currentMonthKey: string;
  overview: PcOverviewSummary;
  periods: PcOverviewPeriod[];
  rows: PcLineSourceRow[];
}) {
  const metrics = useMemo(
    () => buildPcOverviewMetrics(overview, periods, currentMonthKey),
    [currentMonthKey, overview, periods]
  );

  return (
    <ScoreCardGrid
      currentMonthKey={currentMonthKey}
      flowGridClass="grid-cols-5 max-xl:grid-cols-3 max-md:grid-cols-2"
      heroKeys={AGENT_HERO_KEYS}
      metrics={metrics}
      ratioKeys={AGENT_RATIO_KEYS}
      rows={rows}
    />
  );
}

export function PcCompanyOverviewScoreCards({
  currentMonthKey,
  overview,
  periods,
  rows,
}: {
  currentMonthKey: string;
  overview: PcCompanyOverviewSummary;
  periods: PcCompanyOverviewPeriod[];
  rows: PcLineSourceRow[];
}) {
  const metrics = useMemo(
    () => buildPcCompanyOverviewMetrics(overview, periods, currentMonthKey),
    [currentMonthKey, overview, periods]
  );

  return (
    <ScoreCardGrid
      currentMonthKey={currentMonthKey}
      countKeys={COMPANY_COUNT_KEYS}
      flowGridClass="grid-cols-7 max-xl:grid-cols-4 max-md:grid-cols-2"
      heroKeys={COMPANY_HERO_KEYS}
      metrics={metrics}
      ratioKeys={COMPANY_RATIO_KEYS}
      rows={rows}
    />
  );
}

function ScoreCardGrid({
  countKeys = [],
  currentMonthKey,
  flowGridClass,
  heroKeys,
  metrics,
  ratioKeys,
  rows,
}: {
  countKeys?: PcOverviewMetricKey[];
  currentMonthKey: string;
  flowGridClass: string;
  heroKeys: PcOverviewMetricKey[];
  metrics: PcOverviewMetric[];
  ratioKeys: PcOverviewMetricKey[];
  rows: PcLineSourceRow[];
}) {
  const flow = useMemo(
    () => buildPcScoreCards(rows, currentMonthKey),
    [currentMonthKey, rows]
  );
  const pick = (keys: PcOverviewMetricKey[]) =>
    keys.flatMap((key) => metrics.filter((metric) => metric.key === key));
  const monthLabel = flow.latestMonthKey ? formatPcMonthKey(flow.latestMonthKey) : "";
  const policiesLabel = pick(["policies"])[0]?.label ?? "Policies";

  return (
    <div className="grid gap-4 max-md:gap-2">
      <section className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-md:gap-2">
        {pick(heroKeys).map((metric) => (
          <HeroCard hue={METRIC_HUES[metric.key]} key={metric.key} metric={metric} />
        ))}
      </section>

      <section className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-md:gap-2">
        {pick(ratioKeys).map((metric) => (
          <RatioCard hue={METRIC_HUES[metric.key]} key={metric.key} metric={metric} />
        ))}
      </section>

      <section className={`${CARD_CLASS} grid ${flowGridClass}`}>
        {pick(countKeys).map((metric) => (
          <FlowCell
            change={metric.latest && metric.previous ? metric.latest.value - metric.previous.value : null}
            hue={BLUE}
            key={metric.key}
            label={metric.label}
            latest={metric.latest?.value ?? 0}
            monthLabel={monthLabel}
            total={metric.total}
          />
        ))}
        <FlowCell
          change={flow.newBusiness.change}
          hue={BLUE}
          label="New Policy"
          latest={flow.newBusiness.latest}
          monthLabel={monthLabel}
          total={flow.newBusiness.total}
        />
        <FlowCell
          change={flow.renewals.change}
          hue={BLUE}
          label="Renewals"
          latest={flow.renewals.latest}
          monthLabel={monthLabel}
          total={flow.renewals.total}
        />
        <FlowCell
          change={flow.cancellations.change}
          goodWhenDown
          hue={CRITICAL}
          label="Cancellation"
          latest={flow.cancellations.latest}
          monthLabel={monthLabel}
          total={flow.cancellations.total}
        />
        <FlowCell
          hue={BLUE}
          label="Carrier"
          latest={flow.carriers.latest}
          monthLabel={monthLabel}
          total={flow.carriers.total}
        />
        <FlowCell
          hue={BLUE}
          label="Line of Service"
          latest={flow.lines.latest}
          monthLabel={monthLabel}
          total={flow.lines.total}
        />
      </section>

      <p className="text-xs text-slate-500">
        A policy with both New and Renewal rows in the period counts in both New Policy and Renewals, so the two can add up to more than {policiesLabel}.
      </p>
    </div>
  );
}

export function HeroCard({ hue, metric }: { hue: Hue; metric: PcOverviewMetric<string> }) {
  return (
    <article className={`${CARD_CLASS} flex flex-col px-[18px] pb-3.5 pt-4 max-md:p-3`}>
      <div className={LABEL_CLASS}>{metric.label}</div>
      <span
        className="mt-1.5 text-[34px] font-bold leading-[1.1] max-md:text-2xl"
        style={{ color: hue.text }}
      >
        {formatPcMetric(metric.kind, metric.total)}
      </span>
      <PcOverviewSparkline
        className="mt-2.5 h-[74px] w-full"
        color={hue.mark}
        kind={metric.kind}
        label={metric.label}
        points={metric.points}
        variant="calm"
      />
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-slate-500">
        {metric.latest ? (
          <span>
            <i
              className="mr-[5px] inline-block size-2 rounded-full bg-white"
              style={{ boxShadow: `inset 0 0 0 2px ${hue.mark}` }}
            />
            {metric.latest.label} ·{" "}
            <b className="font-semibold text-slate-900">
              {formatPcMetric(metric.kind, metric.latest.value)}
            </b>{" "}
            <MetricDelta metric={metric} />
          </span>
        ) : null}
        {metric.peak ? (
          <span>
            <i
              className="mr-[5px] inline-block size-2 rounded-full"
              style={{ backgroundColor: hue.mark }}
            />
            <PeakText metric={metric} />
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function RatioCard({ hue, metric }: { hue: Hue; metric: PcOverviewMetric<string> }) {
  return (
    <article className={`${CARD_CLASS} px-4 py-3.5 max-md:p-3`}>
      <div className={`${LABEL_CLASS} truncate`} title={metric.label}>
        {metric.label}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_45%] items-center gap-2.5 max-md:grid-cols-1">
        <div className="min-w-0">
          <span
            className="mb-1 mt-[5px] block text-[25px] font-bold leading-[1.1]"
            style={{ color: hue.text }}
          >
            {formatPcMetric(metric.kind, metric.total)}
          </span>
          <MetricDelta metric={metric} />
        </div>
        <PcOverviewSparkline
          className="h-[58px] w-full"
          color={hue.mark}
          kind={metric.kind}
          label={metric.label}
          points={metric.points}
          variant="spark"
        />
      </div>
      {metric.peak ? (
        <div className="mt-1 text-xs text-slate-500 md:whitespace-nowrap">
          <PeakText metric={metric} />
        </div>
      ) : null}
    </article>
  );
}

export function FlowCell({
  change,
  goodWhenDown = false,
  hue,
  label,
  latest,
  monthLabel,
  total,
}: {
  change?: number | null;
  goodWhenDown?: boolean;
  hue: Hue;
  label: string;
  latest: number;
  monthLabel: string;
  total: number;
}) {
  return (
    <div className="border-r border-slate-200 px-[18px] py-3.5 last:border-r-0 max-xl:border-b max-md:p-3">
      <div className={LABEL_CLASS}>{label}</div>
      <span
        className="mb-[3px] mt-[5px] block text-[25px] font-bold leading-[1.1]"
        style={{ color: hue.text }}
      >
        {formatPcMetric("int", total)}
      </span>
      <div className="text-xs text-slate-500">
        {formatPcMetric("int", latest)} in {monthLabel}{" "}
        {change === undefined || change === null ? null : (
          <DeltaText diff={change} goodWhenDown={goodWhenDown} text={`${Math.abs(change)}`} />
        )}
      </div>
    </div>
  );
}

function PeakText({ metric }: { metric: PcOverviewMetric<string> }) {
  if (!metric.peak) return null;

  return (
    <>
      Peak {metric.peak.label} ·{" "}
      <b className="font-semibold text-slate-900">
        {formatPcMetric(metric.kind, metric.peak.value)}
      </b>
    </>
  );
}

function MetricDelta({ metric }: { metric: PcOverviewMetric<string> }) {
  if (!metric.latest || !metric.previous) return null;

  const diff = metric.latest.value - metric.previous.value;

  return (
    <DeltaText
      diff={diff}
      text={formatDelta(metric, diff, metric.previous.value)}
      title={`vs ${metric.previous.label}`}
    />
  );
}

function DeltaText({
  diff,
  goodWhenDown = false,
  text,
  title,
}: {
  diff: number;
  goodWhenDown?: boolean;
  text: string;
  title?: string;
}) {
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "•";
  const tone =
    diff === 0
      ? "text-slate-500"
      : diff > 0 !== goodWhenDown
        ? "text-[#006300]"
        : "text-[#c23333]";

  return (
    <span className={`whitespace-nowrap text-[13px] font-bold ${tone}`} title={title}>
      {arrow} {text}
    </span>
  );
}

function formatDelta(metric: PcOverviewMetric<string>, diff: number, previous: number) {
  if (metric.kind === "int") return `${Math.abs(Math.round(diff))}`;
  if (metric.kind === "pct") return `${Math.abs(diff).toFixed(2)} pt`;
  if (previous === 0) return formatPcMetric("money", Math.abs(diff));

  return `${Math.abs((diff / previous) * 100).toFixed(1)}%`;
}

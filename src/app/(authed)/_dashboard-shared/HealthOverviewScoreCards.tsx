"use client";

import { useMemo } from "react";
import {
  AQUA,
  BLUE,
  CARD_CLASS,
  CRITICAL,
  FlowCell,
  HeroCard,
  ORANGE,
  RatioCard,
  VIOLET,
  type Hue,
} from "./PcOverviewScoreCards";
import { formatPcMonthKey, type PcOverviewMetric } from "./pc-overview-metrics";
import {
  buildHealthAgentMetrics,
  buildHealthCompanyMetrics,
  type HealthAgentMetricKey,
  type HealthAgentPeriod,
  type HealthCompanyMetricKey,
  type HealthCompanyPeriod,
  type HealthCompanySummary,
  type HealthReportYearCommission,
} from "./health-overview-metrics";

type CardSpec<Key extends string> = { key: Key; hue: Hue };
type FlowSpec<Key extends string> = CardSpec<Key> & { goodWhenDown?: boolean };

// Hàng 1 là số chính, hàng 2 là tỉ lệ đứng thẳng dưới số gốc của nó, dải dưới là số đếm.
const AGENT_HEROES: CardSpec<HealthAgentMetricKey>[] = [
  { key: "policies", hue: BLUE },
  { key: "clients", hue: AQUA },
  { key: "monthlyCommission", hue: VIOLET },
  { key: "yearCommission", hue: ORANGE },
];
const AGENT_RATIOS: CardSpec<HealthAgentMetricKey>[] = [
  { key: "paidPolicyRate", hue: BLUE },
  { key: "paidClientRate", hue: AQUA },
  { key: "avgCommPolicy", hue: VIOLET },
  { key: "avgCommMonth", hue: ORANGE },
];
const AGENT_FLOW: FlowSpec<HealthAgentMetricKey>[] = [
  { key: "paidPolicies", hue: BLUE },
  { key: "unpaidPolicies", hue: CRITICAL, goodWhenDown: true },
  { key: "paidClients", hue: BLUE },
  { key: "unpaidClients", hue: CRITICAL, goodWhenDown: true },
];

const COMPANY_HEROES: CardSpec<HealthCompanyMetricKey>[] = [
  { key: "agentCommission", hue: VIOLET },
  { key: "epsCommission", hue: AQUA },
  { key: "epsSplit", hue: ORANGE },
  { key: "epsOverride", hue: BLUE },
];
const COMPANY_RATIOS: CardSpec<HealthCompanyMetricKey>[] = [
  { key: "agentCommRate", hue: VIOLET },
  { key: "epsCommRate", hue: AQUA },
  { key: "epsSplitRate", hue: ORANGE },
  { key: "epsOverrideRate", hue: BLUE },
];
const COMPANY_FLOW: FlowSpec<HealthCompanyMetricKey>[] = [
  { key: "policies", hue: BLUE },
  { key: "clients", hue: BLUE },
  { key: "paidPolicies", hue: BLUE },
  { key: "unpaidPolicies", hue: CRITICAL, goodWhenDown: true },
  { key: "activeAgents", hue: BLUE },
];

export function HealthAgentOverviewScoreCards({
  periods,
  reportYearCommission,
}: {
  periods: HealthAgentPeriod[];
  reportYearCommission: HealthReportYearCommission;
}) {
  const metrics = useMemo(
    () => buildHealthAgentMetrics(periods, reportYearCommission),
    [periods, reportYearCommission]
  );

  return (
    <ScoreCardGrid
      flow={AGENT_FLOW}
      flowGridClass="grid-cols-4 max-md:grid-cols-2"
      heroes={AGENT_HEROES}
      latestMonthKey={periods.at(-1)?.periodKey ?? ""}
      metrics={metrics}
      ratios={AGENT_RATIOS}
    />
  );
}

export function HealthCompanyOverviewScoreCards({
  overview,
  periods,
}: {
  overview: HealthCompanySummary;
  periods: HealthCompanyPeriod[];
}) {
  const metrics = useMemo(
    () => buildHealthCompanyMetrics(overview, periods),
    [overview, periods]
  );

  return (
    <ScoreCardGrid
      flow={COMPANY_FLOW}
      flowGridClass="grid-cols-5 max-xl:grid-cols-3 max-md:grid-cols-2"
      heroes={COMPANY_HEROES}
      latestMonthKey={periods.at(-1)?.periodKey ?? ""}
      metrics={metrics}
      ratios={COMPANY_RATIOS}
    />
  );
}

function ScoreCardGrid<Key extends string>({
  flow,
  flowGridClass,
  heroes,
  latestMonthKey,
  metrics,
  ratios,
}: {
  flow: FlowSpec<Key>[];
  flowGridClass: string;
  heroes: CardSpec<Key>[];
  latestMonthKey: string;
  metrics: PcOverviewMetric<Key>[];
  ratios: CardSpec<Key>[];
}) {
  const pick = <Spec extends CardSpec<Key>>(specs: Spec[]) =>
    specs.flatMap((spec) => {
      const metric = metrics.find((item) => item.key === spec.key);

      return metric ? [{ metric, spec }] : [];
    });
  const monthLabel = latestMonthKey ? formatPcMonthKey(latestMonthKey) : "";

  return (
    <div className="grid gap-4 max-md:gap-2">
      <section className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-md:gap-2">
        {pick(heroes).map(({ metric, spec }) => (
          <HeroCard hue={spec.hue} key={metric.key} metric={metric} />
        ))}
      </section>

      <section className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-md:gap-2">
        {pick(ratios).map(({ metric, spec }) => (
          <RatioCard hue={spec.hue} key={metric.key} metric={metric} />
        ))}
      </section>

      <section className={`${CARD_CLASS} grid ${flowGridClass}`}>
        {pick(flow).map(({ metric, spec }) => (
          <FlowCell
            change={
              metric.latest && metric.previous
                ? metric.latest.value - metric.previous.value
                : null
            }
            goodWhenDown={spec.goodWhenDown}
            hue={spec.hue}
            key={metric.key}
            label={metric.label}
            latest={metric.latest?.value ?? 0}
            monthLabel={monthLabel}
            total={metric.total}
          />
        ))}
      </section>
    </div>
  );
}

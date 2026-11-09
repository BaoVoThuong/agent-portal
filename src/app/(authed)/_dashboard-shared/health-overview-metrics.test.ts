import { describe, expect, it } from "vitest";
import {
  buildHealthAgentMetrics,
  buildHealthCompanyMetrics,
  type HealthAgentPeriod,
  type HealthCompanyPeriod,
} from "./health-overview-metrics";

function agentPeriod(periodKey: string, agentReceived: number, policyCount: number): HealthAgentPeriod {
  return {
    periodKey,
    periodLabel: periodKey,
    policyCount,
    clientCount: policyCount + 1,
    agentReceived,
    paidPolicyCount: policyCount - 1,
    unpaidPolicyCount: 1,
    paidClientCount: policyCount,
    unpaidClientCount: 1,
    policyPaidRate: 90,
    clientPaidRate: 80,
  };
}

function companyPeriod(periodKey: string, agentReceived: number): HealthCompanyPeriod {
  return {
    periodKey,
    periodLabel: periodKey,
    totalMesserPaid: 1000,
    agentReceived,
    epsCommission: 1000 - agentReceived,
    epsSplit: 50,
    epsOverride: 25,
    policyCount: 10,
    clientCount: 12,
    paidPolicyCount: 9,
    unpaidPolicyCount: 1,
    activeAgentCount: 3,
  };
}

const YEAR = { value: 900, averageMonthlyCommission: 300, reportYear: 2026 };

describe("buildHealthAgentMetrics", () => {
  const periods = [
    agentPeriod("2025-12", 100, 4),
    agentPeriod("2026-01", 200, 5),
    agentPeriod("2026-02", 700, 8),
  ];
  const byKey = (key: string) =>
    buildHealthAgentMetrics(periods, YEAR).find((metric) => metric.key === key);

  it("shows the latest month for active counts instead of adding months up", () => {
    expect(byKey("policies")?.total).toBe(8);
    expect(byKey("monthlyCommission")?.total).toBe(700);
  });

  it("keeps the report-year total and draws only that year's months", () => {
    const metric = byKey("yearCommission");

    expect(metric?.label).toBe("2026 Commission");
    expect(metric?.total).toBe(900);
    expect(metric?.points.map((point) => point.label)).toEqual(["2026-01", "2026-02"]);
  });

  it("has nothing to compare the monthly average against", () => {
    expect(byKey("avgCommMonth")?.total).toBe(300);
    expect(byKey("avgCommMonth")?.previous).toBeNull();
  });

  it("compares with the month right before only when it has data", () => {
    const gap = [agentPeriod("2026-01", 200, 5), agentPeriod("2026-03", 700, 8)];
    const metric = buildHealthAgentMetrics(gap, YEAR).find((item) => item.key === "policies");

    expect(metric?.previous).toBeNull();
  });

  it("renders zeros when no month matches the filters", () => {
    const metrics = buildHealthAgentMetrics([], { value: 0, averageMonthlyCommission: 0, reportYear: null });

    expect(metrics.find((metric) => metric.key === "policies")?.total).toBe(0);
    expect(metrics.find((metric) => metric.key === "yearCommission")?.label).toBe("Report Year Commission");
  });
});

describe("buildHealthCompanyMetrics", () => {
  it("uses the filter total for the big number and the share of carrier paid for rates", () => {
    const overview = { ...companyPeriod("all", 600), totalMesserPaid: 2000 };
    const metrics = buildHealthCompanyMetrics(overview, [
      companyPeriod("2026-01", 200),
      companyPeriod("2026-02", 400),
    ]);

    expect(metrics.find((metric) => metric.key === "agentCommission")?.total).toBe(600);
    expect(metrics.find((metric) => metric.key === "agentCommRate")?.total).toBe(30);
    expect(metrics.find((metric) => metric.key === "agentCommission")?.latest?.value).toBe(400);
  });

  it("does not divide by zero when nothing was paid", () => {
    const overview = { ...companyPeriod("all", 0), totalMesserPaid: 0 };

    expect(
      buildHealthCompanyMetrics(overview, []).find((metric) => metric.key === "epsCommRate")?.total
    ).toBe(0);
  });
});

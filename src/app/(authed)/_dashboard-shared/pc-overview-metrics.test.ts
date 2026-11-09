import { describe, expect, it } from "vitest";
import {
  buildPcCompanyOverviewMetrics,
  buildPcOverviewMetrics,
  formatPcMetric,
  type PcOverviewPeriod,
  type PcOverviewSummary,
} from "./pc-overview-metrics";

const overview: PcOverviewSummary = {
  activePolicyCount: 5,
  agentCommission: 300,
  policyCount: 10,
  renewalPolicyCount: 4,
  totalPremium: 3000,
};

function period(periodKey: string, values: Partial<PcOverviewSummary> = {}): PcOverviewPeriod {
  return {
    activePolicyCount: 1,
    agentCommission: 100,
    periodKey,
    periodLabel: periodKey,
    policyCount: 2,
    renewalPolicyCount: 1,
    totalPremium: 1000,
    ...values,
  };
}

const metric = (
  key: string,
  periods: PcOverviewPeriod[],
  current = "2026-11"
) => buildPcOverviewMetrics(overview, periods, current).find((item) => item.key === key)!;

describe("buildPcOverviewMetrics", () => {
  it("keeps the filtered total and computes ratios for each month", () => {
    const rate = metric("renewalRate", [period("2026-10", { renewalPolicyCount: 1, policyCount: 4 })]);

    expect(rate.total).toBe(40);
    expect(rate.points).toEqual([{ label: "2026-10", value: 25 }]);
  });

  it("finds the peak and the latest month", () => {
    const commission = metric("commission", [
      period("2026-09", { agentCommission: 50 }),
      period("2026-10", { agentCommission: 900 }),
      period("2026-11", { agentCommission: 70 }),
    ]);

    expect(commission.peak).toEqual({ label: "2026-10", value: 900 });
    expect(commission.latest).toEqual({ label: "2026-11", value: 70 });
    expect(commission.previous).toEqual({ label: "2026-10", value: 900 });
  });

  it("leaves future months out of the line but not out of the total", () => {
    const commission = metric("commission", [
      period("2026-11", { agentCommission: 70 }),
      period("2026-12", { agentCommission: 9000 }),
    ]);

    expect(commission.total).toBe(300);
    expect(commission.points).toHaveLength(1);
    expect(commission.latest?.label).toBe("2026-11");
    expect(commission.peak?.value).toBe(70);
  });

  it("does not compare with a month that is not right before", () => {
    const commission = metric("commission", [period("2026-08"), period("2026-10")]);

    expect(commission.previous).toBeNull();
  });

  it("crosses a year when looking for the previous month", () => {
    const commission = metric("commission", [period("2025-12"), period("2026-01")], "2026-01");

    expect(commission.previous?.label).toBe("2025-12");
  });

  it("handles no months and months with nothing sold", () => {
    expect(metric("avgPremium", []).latest).toBeNull();
    expect(metric("avgPremium", []).peak).toBeNull();
    expect(metric("avgPremium", [period("2026-11", { policyCount: 0 })]).latest?.value).toBe(0);
  });
});

describe("buildPcCompanyOverviewMetrics", () => {
  const summary = {
    policyCount: 10,
    activePolicyCount: 8,
    renewalPolicyCount: 5,
    totalPremium: 1000,
    agentCommission: 50,
    totalCommission: 150,
    epsCommission: 100,
  };

  it("adds the company commission metrics and rates", () => {
    const metrics = buildPcCompanyOverviewMetrics(
      summary,
      [{ ...summary, periodKey: "2026-10", periodLabel: "Oct 2026" }],
      "2026-11"
    );
    const read = (key: string) => metrics.find((metric) => metric.key === key);

    expect(metrics).toHaveLength(10);
    expect(read("avgPremium")?.label).toBe("Premium per Policy");
    expect(read("avgPremium")?.total).toBe(100);
    expect(read("totalCommission")?.total).toBe(150);
    expect(read("epsCommission")?.points).toEqual([{ label: "Oct 2026", value: 100 }]);
    expect(read("totalCommRate")?.total).toBe(15);
    expect(read("epsCommRate")?.total).toBe(10);
    expect(read("policies")?.label).toBe("Policies Sold");
  });

  it("keeps the company-only metrics off the agent cards", () => {
    const keys = buildPcOverviewMetrics(summary, [], "2026-11").map((metric) => metric.key);

    expect(keys).not.toContain("totalCommission");
    expect(keys).not.toContain("epsCommission");
    expect(keys).not.toContain("epsCommRate");
  });
});

describe("formatPcMetric", () => {
  it("formats each kind", () => {
    expect(formatPcMetric("money", 1190000)).toBe("$1.19M");
    expect(formatPcMetric("money", 8130)).toBe("$8.13K");
    expect(formatPcMetric("money", 132.95)).toBe("$132.95");
    expect(formatPcMetric("int", 1234)).toBe("1,234");
    expect(formatPcMetric("pct", 37.7)).toBe("37.70%");
  });
});

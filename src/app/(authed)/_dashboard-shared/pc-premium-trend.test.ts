import { describe, expect, it } from "vitest";
import type { PcLineSourceRow } from "./pc-line-of-service";
import { buildPcPremiumTrendPoints } from "./pc-premium-trend";

function row(type: string | null, premium: number, month = "2026-10"): PcLineSourceRow {
  return {
    agent_commission_amount: 0,
    company: "GEICO",
    effective_date: `${month}-01`,
    policy_number: "P",
    premium,
    status: "NEW",
    true_premium: premium,
    type,
  };
}

const periods = [
  { key: "2026-09", label: "Sep", policies: 1, premium: 100 },
  { key: "2026-10", label: "Oct", policies: 3, premium: 700 },
];
const byMonth = (item: PcLineSourceRow) => item.effective_date?.slice(0, 7) ?? "";

describe("buildPcPremiumTrendPoints", () => {
  it("splits each period's premium by line", () => {
    const points = buildPcPremiumTrendPoints(
      periods,
      [row("AUTO", 100, "2026-09"), row("AUTO", 300), row("HOME", 400)],
      byMonth
    );

    expect(points[0].premiumByLine).toEqual({ Auto: 100 });
    expect(points[1]).toEqual({
      label: "Oct",
      policies: 3,
      premium: 700,
      premiumByLine: { Auto: 300, Home: 400 },
      policiesByLine: { Auto: 1, Home: 1 },
    });
  });

  it("counts each sold policy once per line", () => {
    const [, october] = buildPcPremiumTrendPoints(
      periods,
      [
        { ...row("AUTO", 100), policy_number: "A" },
        { ...row("AUTO", 200), policy_number: "A" },
        { ...row("AUTO", 300), policy_number: "B" },
        { ...row("AUTO", -50), policy_number: "C" },
      ],
      byMonth
    );

    expect(october.policiesByLine).toEqual({ Auto: 2 });
  });

  it("folds small lines and rows with no line into Other", () => {
    const [, october] = buildPcPremiumTrendPoints(
      periods,
      [row("UMBRELLA", 10), row("WIND", 20), row(null, 30)],
      byMonth
    );

    expect(october.premiumByLine).toEqual({ Other: 60 });
  });

  it("does not count cancelled premium, so the stack matches total premium", () => {
    const [, october] = buildPcPremiumTrendPoints(
      periods,
      [row("AUTO", 500), row("AUTO", -500)],
      byMonth
    );

    expect(october.premiumByLine).toEqual({ Auto: 500 });
  });

  it("keeps a period that has no sold premium", () => {
    expect(buildPcPremiumTrendPoints(periods, [], byMonth)[0].premiumByLine).toEqual({});
  });
});

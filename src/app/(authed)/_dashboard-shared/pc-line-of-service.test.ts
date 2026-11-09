import { describe, expect, it } from "vitest";
import {
  buildPcLineRows,
  buildPcScoreCards,
  getPcLineLabel,
  type PcLineSourceRow,
} from "./pc-line-of-service";

function row(overrides: Partial<PcLineSourceRow>): PcLineSourceRow {
  return {
    agent_commission_amount: 0,
    company: "GEICO",
    effective_date: "2026-10-15",
    eps_commission_amount: 0,
    policy_number: "P1",
    premium: 1000,
    status: "NEW",
    total_commission: 0,
    true_premium: 1000,
    type: "AUTO",
    ...overrides,
  };
}

describe("getPcLineLabel", () => {
  it("shows the standard lines in title case", () => {
    expect(getPcLineLabel("DWELLING")).toBe("Dwelling");
    expect(getPcLineLabel(" home ")).toBe("Home");
    expect(getPcLineLabel("MOBILE HOME")).toBe("Mobile Home");
    expect(getPcLineLabel(null)).toBe("Unspecified");
    expect(getPcLineLabel("  ")).toBe("Unspecified");
  });
});

describe("buildPcScoreCards", () => {
  it("compares the latest month with the month right before it", () => {
    const cards = buildPcScoreCards([
      row({ policy_number: "A", effective_date: "2026-10-02" }),
      row({ policy_number: "B", effective_date: "2026-10-03" }),
      row({ policy_number: "C", effective_date: "2026-09-03" }),
      row({ policy_number: "D", effective_date: "2026-09-04", status: "RENEWAL" }),
    ]);

    expect(cards.latestMonthKey).toBe("2026-10");
    expect(cards.newBusiness).toEqual({ total: 3, latest: 2, change: 1 });
    expect(cards.renewals).toEqual({ total: 1, latest: 0, change: -1 });
  });

  it("crosses a year boundary when finding the previous month", () => {
    const cards = buildPcScoreCards([
      row({ policy_number: "A", effective_date: "2026-01-02" }),
      row({ policy_number: "B", effective_date: "2025-12-02" }),
    ]);

    expect(cards.newBusiness.change).toBe(0);
  });

  it("has no change when the previous month is outside the filtered data", () => {
    const cards = buildPcScoreCards([
      row({ policy_number: "A", effective_date: "2026-10-02" }),
      row({ policy_number: "B", effective_date: "2026-08-02" }),
    ]);

    expect(cards.newBusiness.change).toBeNull();
  });

  it("counts a cancelled policy that only has a negative row", () => {
    const cards = buildPcScoreCards([
      row({ policy_number: "A", premium: -500, true_premium: -500, status: "CANCEL" }),
      row({ policy_number: "B" }),
    ]);

    expect(cards.cancellations.total).toBe(1);
    expect(cards.newBusiness.total).toBe(1);
  });

  it("counts one policy once across its rows", () => {
    const cards = buildPcScoreCards([
      row({ policy_number: "A", premium: 600, true_premium: 600 }),
      row({ policy_number: "A", premium: 400, true_premium: 400 }),
    ]);

    expect(cards.newBusiness.total).toBe(1);
    expect(cards.premiumPerPolicy.total).toBe(1000);
  });

  it("ignores carriers and lines with no sold premium or no name", () => {
    const cards = buildPcScoreCards([
      row({ policy_number: "A", company: "GEICO", type: "AUTO" }),
      row({ policy_number: "B", company: "SAGESURE", type: "DP" }),
      row({ policy_number: "C", company: "OLD", type: "FLOOD", true_premium: -1, premium: -1 }),
      row({ policy_number: "D", company: null, type: null }),
    ]);

    expect(cards.carriers.total).toBe(2);
    expect(cards.lines.total).toBe(2);
  });
});

describe("buildPcLineRows", () => {
  it("adds up each line and shares against the total", () => {
    const rows = buildPcLineRows([
      row({ policy_number: "A", type: "HOME", true_premium: 3000, total_commission: 300, eps_commission_amount: 75, agent_commission_amount: 225 }),
      row({ policy_number: "B", type: "AUTO", true_premium: 1000, total_commission: 100 }),
    ]);

    expect(rows.map((line) => line.label)).toEqual(["Home", "Auto"]);
    expect(rows[0]).toMatchObject({
      agentCommission: 225,
      epsCommission: 75,
      policyCount: 1,
      policySharePercent: 50,
      premiumPerPolicy: 3000,
      premiumSharePercent: 75,
      totalCommission: 300,
      totalPremium: 3000,
    });
    expect(rows[1]).toMatchObject({
      policySharePercent: 50,
      premiumSharePercent: 25,
      totalPremium: 1000,
    });
  });

  it("keeps a cancellation's negative commission without counting its premium", () => {
    const [line] = buildPcLineRows([
      row({ policy_number: "A", true_premium: 1000, total_commission: 100 }),
      row({ policy_number: "A", true_premium: -1000, total_commission: -100, status: "CANCEL" }),
    ]);

    expect(line.totalPremium).toBe(1000);
    expect(line.totalCommission).toBe(0);
    expect(line.policyCount).toBe(1);
  });

  it("puts rows with no line last even when they are largest", () => {
    const rows = buildPcLineRows([
      row({ policy_number: "A", type: null, true_premium: 9000 }),
      row({ policy_number: "B", type: "AUTO", true_premium: 100 }),
    ]);

    expect(rows.map((line) => line.label)).toEqual(["Auto", "Unspecified"]);
  });

  it("handles no rows without dividing by zero", () => {
    expect(buildPcLineRows([])).toEqual([]);
  });
});

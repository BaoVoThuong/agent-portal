import { describe, expect, it } from "vitest";
import { parseHealthStructuredQuery } from "@/lib/ai/health-query-schema";

describe("parseHealthStructuredQuery", () => {
  it("trả null khi metric không hợp lệ", () => {
    expect(parseHealthStructuredQuery({ metric: "x", filters: {} })).toBeNull();
    expect(parseHealthStructuredQuery(null)).toBeNull();
  });

  it("chấp nhận metric Health", () => {
    for (const metric of [
      "policy_count",
      "client_count",
      "policy_paid_rate",
      "sum_eps_override",
      "agent_commission_rate",
    ]) {
      expect(parseHealthStructuredQuery({ metric, filters: {} })?.metric).toBe(metric);
    }
  });

  it("giữ filter hợp lệ, bỏ field lạ", () => {
    const q = parseHealthStructuredQuery({
      metric: "client_count",
      filters: {
        monthStart: "2026-01",
        monthEnd: "2026-03",
        carrier: "GEICO",
        state: "TX",
        paid: "paid",
        evil: "x",
      },
      groupBy: "carrier",
    });
    expect(q!.filters).toEqual({
      monthStart: "2026-01",
      monthEnd: "2026-03",
      carrier: "GEICO",
      state: "TX",
      paid: "paid",
    });
    expect(q!.groupBy).toBe("carrier");
  });

  it("bỏ paid = any; hoán đổi month đảo ngược", () => {
    const q = parseHealthStructuredQuery({
      metric: "policy_count",
      filters: { paid: "any", monthStart: "2026-05", monthEnd: "2026-01" },
    });
    expect(q!.filters.paid).toBeUndefined();
    expect(q!.filters.monthStart).toBe("2026-01");
    expect(q!.filters.monthEnd).toBe("2026-05");
  });
});

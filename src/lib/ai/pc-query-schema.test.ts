import { describe, expect, it } from "vitest";
import { parsePcStructuredQuery } from "@/lib/ai/pc-query-schema";

describe("parsePcStructuredQuery", () => {
  it("trả null khi metric không hợp lệ", () => {
    expect(parsePcStructuredQuery({ metric: "drop_table", filters: {} })).toBeNull();
    expect(parsePcStructuredQuery(null)).toBeNull();
    expect(parsePcStructuredQuery({})).toBeNull();
  });

  it("chấp nhận metric nghiệp vụ mới", () => {
    for (const metric of [
      "active_count",
      "renewal_rate",
      "estimate_unpaid_agent_commission",
      "sum_total_commission",
    ]) {
      expect(parsePcStructuredQuery({ metric, filters: {} })?.metric).toBe(metric);
    }
  });

  it("giữ filter hợp lệ và bỏ field lạ (kể cả agent_name)", () => {
    const q = parsePcStructuredQuery({
      metric: "count",
      filters: {
        monthStart: "2026-03",
        monthEnd: "2026-03",
        type: "Auto",
        policyScope: "active",
        paid: "unpaid",
        evilField: "x",
        agent_name: "SOMEONE ELSE",
      },
      groupBy: "company",
    });
    expect(q!.filters).toEqual({
      monthStart: "2026-03",
      monthEnd: "2026-03",
      type: "Auto",
      policyScope: "active",
      paid: "unpaid",
    });
    expect(Object.keys(q!.filters)).not.toContain("agent_name");
  });

  it("loại month sai định dạng và text chứa ký tự nguy hiểm", () => {
    const q = parsePcStructuredQuery({
      metric: "list",
      filters: { monthStart: "March", type: "a;DROP TABLE pc_mart" },
    });
    expect(q!.filters.monthStart).toBeUndefined();
    expect(q!.filters.type).toBeUndefined();
  });

  it("hoán đổi khi monthStart > monthEnd", () => {
    const q = parsePcStructuredQuery({
      metric: "count",
      filters: { monthStart: "2026-05", monthEnd: "2026-01" },
    });
    expect(q!.filters.monthStart).toBe("2026-01");
    expect(q!.filters.monthEnd).toBe("2026-05");
  });

  it("bỏ policyScope/paid = any", () => {
    const q = parsePcStructuredQuery({
      metric: "count",
      filters: { policyScope: "any", paid: "any" },
    });
    expect(q!.filters.policyScope).toBeUndefined();
    expect(q!.filters.paid).toBeUndefined();
  });

  it("giữ cờ unsupported", () => {
    const q = parsePcStructuredQuery({
      metric: "list",
      filters: {},
      unsupported: true,
    });
    expect(q!.unsupported).toBe(true);
  });
});

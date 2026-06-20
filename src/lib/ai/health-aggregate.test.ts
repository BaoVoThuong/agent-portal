import { describe, expect, it } from "vitest";
import { aggregateHealthRows, type HealthMartRow } from "@/lib/ai/health-aggregate";
import type { HealthStructuredQuery } from "@/lib/ai/health-query-schema";

function row(p: Partial<HealthMartRow>): HealthMartRow {
  return {
    deal_name: null,
    state: null,
    carrier: null,
    plan_name: null,
    primary_member_id: "M1",
    agent: "A",
    broker_effective_date: "2026-01-01",
    paid_to_date: null,
    report_month: "2026-01-01",
    carriers_messer_paid: null,
    agent_received: null,
    eps_override_received: null,
    eps_split: null,
    num_client: 1,
    ...p,
  };
}

function q(partial: Partial<HealthStructuredQuery>): HealthStructuredQuery {
  return { metric: "policy_count", filters: {}, ...partial };
}

describe("aggregateHealthRows — eligible + đếm", () => {
  it("policy_count đếm unique theo (report_month, member); bỏ dòng thiếu khoá", () => {
    const r = aggregateHealthRows(
      [
        row({ primary_member_id: "M1", report_month: "2026-01-01" }),
        row({ primary_member_id: "M1", report_month: "2026-01-01" }), // trùng -> 1
        row({ primary_member_id: "M2", report_month: "2026-01-01" }),
        row({ primary_member_id: "", report_month: "2026-01-01" }), // thiếu member -> loại
        row({ primary_member_id: "M3", report_month: null }), // thiếu report -> loại
      ],
      q({ metric: "policy_count" })
    );
    expect(r.total).toBe(2);
  });

  it("cùng member ở NHIỀU tháng = 1 policy unique; client = MAX(num_client)", () => {
    // Khớp dashboard: member chỉ tính 1 lần dù report nhiều tháng (verify data thật).
    const rows = [
      row({ primary_member_id: "M1", report_month: "2026-01-01", num_client: 2 }),
      row({ primary_member_id: "M1", report_month: "2026-02-01", num_client: 4 }),
      row({ primary_member_id: "M1", report_month: "2026-03-01", num_client: 3 }),
    ];
    expect(aggregateHealthRows(rows, q({ metric: "policy_count" })).total).toBe(1);
    // client = max(2,4,3) = 4 (KHÔNG cộng dồn = 9)
    expect(aggregateHealthRows(rows, q({ metric: "client_count" })).total).toBe(4);
  });

  it("loại dòng effective_month > report_month (chưa hiệu lực)", () => {
    const r = aggregateHealthRows(
      [
        row({
          primary_member_id: "M1",
          report_month: "2026-01-01",
          broker_effective_date: "2026-03-01", // sau report -> loại
        }),
      ],
      q({ metric: "policy_count" })
    );
    expect(r.total).toBe(0);
  });

  it("client_count = tổng max(num_client) theo policy; >= policy_count", () => {
    const r = aggregateHealthRows(
      [
        row({ primary_member_id: "M1", num_client: 3 }),
        row({ primary_member_id: "M1", num_client: 2 }), // cùng policy -> max 3
        row({ primary_member_id: "M2", num_client: 4 }),
      ],
      q({ metric: "client_count" })
    );
    expect(r.total).toBe(7); // 3 + 4
    expect(r.policyCount).toBe(2);
  });

  it("paid theo paid_to_date; policy_paid_rate đúng", () => {
    const rows = [
      row({ primary_member_id: "M1", paid_to_date: "2026-02-01" }),
      row({ primary_member_id: "M2", paid_to_date: null }),
    ];
    expect(aggregateHealthRows(rows, q({ metric: "paid_policy_count" })).total).toBe(1);
    expect(aggregateHealthRows(rows, q({ metric: "unpaid_policy_count" })).total).toBe(1);
    expect(aggregateHealthRows(rows, q({ metric: "policy_paid_rate" })).total).toBeCloseTo(50);
  });

  it("unpaid_policy_count = member KHÔNG tháng nào paid (bool_or); bỏ qua filter paid", () => {
    // M1: Jan paid, Feb/Mar unpaid -> member PAID (có 1 tháng paid). M2: cả 2 unpaid.
    const rows = [
      row({ primary_member_id: "M1", report_month: "2026-01-01", paid_to_date: "2026-01-31" }),
      row({ primary_member_id: "M1", report_month: "2026-02-01", paid_to_date: null }),
      row({ primary_member_id: "M2", report_month: "2026-01-01", paid_to_date: null }),
      row({ primary_member_id: "M2", report_month: "2026-02-01", paid_to_date: null }),
    ];
    // unpaid = chỉ M2 (M1 có tháng paid). Dù LLM lỡ set paid:unpaid vẫn phải = 1.
    expect(aggregateHealthRows(rows, q({ metric: "unpaid_policy_count" })).total).toBe(1);
    expect(
      aggregateHealthRows(rows, q({ metric: "unpaid_policy_count", filters: { paid: "unpaid" } })).total
    ).toBe(1);
    expect(aggregateHealthRows(rows, q({ metric: "paid_policy_count" })).total).toBe(1);
  });

  it("eps_commission = messer_paid - agent_received; rate trên messer_paid", () => {
    const rows = [
      row({
        primary_member_id: "M1",
        carriers_messer_paid: 1000,
        agent_received: 600,
      }),
    ];
    expect(aggregateHealthRows(rows, q({ metric: "sum_eps_commission" })).total).toBeCloseTo(400);
    expect(aggregateHealthRows(rows, q({ metric: "agent_commission_rate" })).total).toBeCloseTo(60);
    expect(aggregateHealthRows(rows, q({ metric: "eps_commission_rate" })).total).toBeCloseTo(40);
  });

  it("paid filter unpaid + groupBy carrier", () => {
    const r = aggregateHealthRows(
      [
        row({ primary_member_id: "M1", carrier: "GEICO", paid_to_date: null }),
        row({ primary_member_id: "M2", carrier: "GEICO", paid_to_date: "x" }),
        row({ primary_member_id: "M3", carrier: "AETNA", paid_to_date: null }),
      ],
      q({ metric: "policy_count", filters: { paid: "unpaid" }, groupBy: "carrier" })
    );
    expect(r.groups).toEqual([
      { key: "GEICO", value: 1 },
      { key: "AETNA", value: 1 },
    ]);
    expect(r.total).toBe(2);
  });
});

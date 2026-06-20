import { describe, expect, it } from "vitest";
import { aggregatePcRows, type PcMartRow } from "@/lib/ai/pc-aggregate";
import type { PcStructuredQuery } from "@/lib/ai/pc-query-schema";

const TODAY = new Date("2026-06-19T00:00:00Z");

function row(p: Partial<PcMartRow>): PcMartRow {
  return {
    agent_name: "A",
    agency_name: null,
    insured_name: null,
    type: null,
    company: null,
    policy_number: null,
    premium: null,
    true_premium: null,
    carrier_commission: null,
    agent_commission_amount: null,
    total_commission: null,
    eps_commission_amount: null,
    effective_date: null,
    expired_date: null,
    status: null,
    paid_producer: null,
    state: null,
    city: null,
    ...p,
  };
}

function q(partial: Partial<PcStructuredQuery>): PcStructuredQuery {
  return { metric: "count", filters: {}, ...partial };
}

describe("aggregatePcRows — định nghĩa nghiệp vụ", () => {
  it("count = số policy unique có premium>0 (coalesce true_premium ?? premium)", () => {
    const r = aggregatePcRows(
      [
        row({ policy_number: "P1", true_premium: 100 }),
        row({ policy_number: "P1", true_premium: 100 }), // trùng -> 1
        row({ policy_number: "P2", premium: 50 }), // dùng premium khi true_premium null
        row({ policy_number: "P3", premium: 0 }), // premium 0 -> loại
      ],
      q({ metric: "count" }),
      TODAY
    );
    expect(r.total).toBe(2);
  });

  it("sum_premium coalesce và sàn 0", () => {
    const r = aggregatePcRows(
      [row({ true_premium: 100 }), row({ premium: 50.5 }), row({ true_premium: -10 })],
      q({ metric: "sum_premium" }),
      TODAY
    );
    expect(r.total).toBeCloseTo(150.5);
  });

  it("active_count: premium>0 và expired_date >= hôm nay", () => {
    const r = aggregatePcRows(
      [
        row({ policy_number: "A", premium: 10, expired_date: "2026-12-31" }), // active
        row({ policy_number: "B", premium: 10, expired_date: "2026-01-01" }), // hết hạn
        row({ policy_number: "C", premium: 10, expired_date: null }), // không có hạn -> không active
      ],
      q({ metric: "active_count" }),
      TODAY
    );
    expect(r.total).toBe(1);
  });

  it("renewal_rate = % policy status=RENEWAL (không phân biệt hoa thường)", () => {
    const r = aggregatePcRows(
      [
        row({ policy_number: "A", premium: 10, status: "Renewal" }),
        row({ policy_number: "B", premium: 10, status: "NEW" }),
        row({ policy_number: "C", premium: 10, status: "RENEWAL" }),
        row({ policy_number: "D", premium: 10, status: null }),
      ],
      q({ metric: "renewal_rate" }),
      TODAY
    );
    expect(r.total).toBeCloseTo(50); // 2/4
  });

  it("estimate_unpaid_agent_commission: DP factor 0.75, agent 0.75; chỉ unpaid", () => {
    // premium 1000, carrier rate 0.1, agency DP(0.75), agent thường(0.75)
    // total = 0.1*1000*0.75 = 75 ; agent = 75*0.75 = 56.25
    const r = aggregatePcRows(
      [
        row({
          policy_number: "U1",
          true_premium: 1000,
          carrier_commission: 0.1,
          agency_name: "DP",
          agent_name: "NAM",
          paid_producer: null, // unpaid
        }),
        row({
          policy_number: "P1",
          true_premium: 1000,
          carrier_commission: 0.1,
          agency_name: "DP",
          agent_name: "NAM",
          paid_producer: "06/01/2026", // paid -> bỏ qua
        }),
      ],
      q({ metric: "estimate_unpaid_agent_commission" }),
      TODAY
    );
    expect(r.total).toBeCloseTo(56.25);
  });

  it("estimate_unpaid: policyCount CHỈ đếm unpaid (không gộp paid) — bug '685'", () => {
    const r = aggregatePcRows(
      [
        row({
          policy_number: "U1",
          true_premium: 1000,
          carrier_commission: 0.1,
          agency_name: "DP",
          paid_producer: null, // unpaid
        }),
        // 3 policy paid: KHÔNG được tính vào policyCount của metric unpaid
        row({ policy_number: "P1", premium: 100, paid_producer: "06/01" }),
        row({ policy_number: "P2", premium: 100, paid_producer: "06/01" }),
        row({ policy_number: "P3", premium: 100, paid_producer: "06/01" }),
      ],
      q({ metric: "estimate_unpaid_agent_commission" }),
      TODAY
    );
    expect(r.policyCount).toBe(1); // chỉ U1, không phải 4
    expect(r.total).toBeCloseTo(56.25);
  });

  it("estimate: FIONA dùng agent rate 0.6; fallback carrier rate theo company", () => {
    // company X có 1 policy có rate 0.2 -> avg = 0.2 dùng cho policy thiếu rate
    // premium 500, TWFG(0.8), FIONA(0.6): total=0.2*500*0.8=80 ; agent=80*0.6=48
    const r = aggregatePcRows(
      [
        row({ company: "X", carrier_commission: 0.2, premium: 1, paid_producer: "x" }),
        row({
          policy_number: "U",
          company: "X",
          carrier_commission: null, // dùng avg theo company = 0.2
          true_premium: 500,
          agency_name: "TWFG",
          agent_name: "Fiona",
          paid_producer: null,
        }),
      ],
      q({ metric: "estimate_unpaid_agent_commission" }),
      TODAY
    );
    expect(r.total).toBeCloseTo(48);
  });

  it("3 loại commission rate phân biệt tử số (agent/total/eps)", () => {
    const rows = [
      row({
        policy_number: "P1",
        true_premium: 1000,
        agent_commission_amount: 60,
        total_commission: 100,
        eps_commission_amount: 40,
      }),
    ];
    expect(aggregatePcRows(rows, q({ metric: "agent_commission_rate" }), TODAY).total).toBeCloseTo(6);
    expect(aggregatePcRows(rows, q({ metric: "total_commission_rate" }), TODAY).total).toBeCloseTo(10);
    expect(aggregatePcRows(rows, q({ metric: "eps_commission_rate" }), TODAY).total).toBeCloseTo(4);
  });

  it("paid='unpaid' lọc, sum_agent_commission cộng đúng", () => {
    const r = aggregatePcRows(
      [
        row({ premium: 10, agent_commission_amount: 100, paid_producer: null }),
        row({ premium: 10, agent_commission_amount: 999, paid_producer: "paid" }),
      ],
      q({ metric: "sum_agent_commission", filters: { paid: "unpaid" } }),
      TODAY
    );
    expect(r.total).toBe(100);
  });

  it("groupBy state đếm policy theo bang", () => {
    const r = aggregatePcRows(
      [
        row({ policy_number: "P1", premium: 10, state: "TX" }),
        row({ policy_number: "P2", premium: 10, state: "TX" }),
        row({ policy_number: "P3", premium: 10, state: "CA" }),
      ],
      q({ metric: "count", groupBy: "state" }),
      TODAY
    );
    expect(r.groups).toEqual([
      { key: "TX", value: 2 },
      { key: "CA", value: 1 },
    ]);
  });

  it("groupBy company gộp + sắp giảm dần", () => {
    const r = aggregatePcRows(
      [
        row({ company: "X", premium: 10 }),
        row({ company: "Y", premium: 30 }),
        row({ company: "X", premium: 5 }),
      ],
      q({ metric: "sum_premium", groupBy: "company" }),
      TODAY
    );
    expect(r.groups).toEqual([
      { key: "Y", value: 30 },
      { key: "X", value: 15 },
    ]);
  });

  it("policyCount = unique theo policy_number, KHÁC rowCount khi 1 policy nhiều dòng", () => {
    const r = aggregatePcRows(
      [
        row({ policy_number: "P1", premium: 10 }),
        row({ policy_number: "P1", premium: 10 }), // cùng policy, dòng statement khác
        row({ policy_number: "P1", premium: 10 }),
        row({ policy_number: "P2", premium: 10 }),
      ],
      q({ metric: "sum_premium" }),
      TODAY
    );
    expect(r.rowCount).toBe(4); // 4 dòng thô
    expect(r.policyCount).toBe(2); // chỉ 2 policy unique
  });

  it("metric list trả sample (cap 20)", () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({ policy_number: `P${i}`, premium: 1 })
    );
    const r = aggregatePcRows(rows, q({ metric: "list" }), TODAY);
    expect(r.sample).toHaveLength(20);
    expect(r.rowCount).toBe(25);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildHealthStatementReport,
  type HealthMartRow,
} from "@/lib/automation/health-statement/report";
import type { PaymentSummaryRow } from "@/lib/automation/health-statement/types";

// Golden-master: khoá behavior reconciliation hoa hồng health-statement.
// monthReport = "2024-06" => so khớp base policy của report_month "05-2024",
// effective_date phải < 2024-06-01, paid_to_date phải <= 2024-06-30.

function policy(over: Partial<HealthMartRow>): HealthMartRow {
  return {
    agent: "AGENT A",
    deal_number: 1,
    deal_name: "DEAL",
    carrier: "BCBS",
    state: "TX",
    plan_name: "PLAN",
    primary_member_id: "M100",
    broker_effective_date: "2024-04-01",
    report_month: "2024-05",
    ...over,
  };
}

function payment(over: Partial<PaymentSummaryRow>): PaymentSummaryRow {
  return {
    agent: "AGENT A",
    carrier_name: "BCBS",
    customer_id: "M100",
    customer_name: "CUST",
    effective_date: "2024-04-01",
    paid_to_date: "2024-06-10",
    gross_compensation: 100,
    transaction_id: "T1",
    statement: "S1",
    ...over,
  };
}

describe("buildHealthStatementReport", () => {
  it("base policy có payment khớp -> vào paymentForProducer (used)", () => {
    const report = buildHealthStatementReport({
      carrier: "BCBS",
      monthReport: "2024-06",
      healthMart: [policy({})],
      payments: [payment({})],
    });

    expect(report.paymentForProducer).toHaveLength(1);
    expect(report.paymentForProducer[0].carriers_messer_paid).toBe(100);
    expect(report.totals.used).toBe(100);
    expect(report.totals.totalPayment).toBe(100);
    expect(report.totals.unclaimed).toBe(0);
    expect(report.totals.duplicate).toBe(0);
    expect(report.totals.final).toBe(100);
    expect(report.totals.balanced).toBe(true);
  });

  it("payment không khớp policy nào -> unclaimed (base policy vẫn tạo dòng paid=0)", () => {
    const report = buildHealthStatementReport({
      carrier: "BCBS",
      monthReport: "2024-06",
      healthMart: [policy({})],
      payments: [
        payment({ customer_id: "ZZZ999", transaction_id: "T9" }),
      ],
    });

    // Mỗi base policy luôn tạo 1 dòng producer; không match -> carriers_messer_paid = 0.
    expect(report.paymentForProducer).toHaveLength(1);
    expect(report.paymentForProducer[0].carriers_messer_paid).toBe(0);
    expect(report.unclaimedPayment).toHaveLength(1);
    expect(report.totals.used).toBe(0);
    expect(report.totals.unclaimed).toBe(100);
    expect(report.totals.totalPayment).toBe(100);
    expect(report.totals.balanced).toBe(true);
  });

  it("payment lọc theo carrier", () => {
    const report = buildHealthStatementReport({
      carrier: "BCBS",
      monthReport: "2024-06",
      healthMart: [policy({})],
      payments: [payment({ carrier_name: "AETNA" })],
    });
    // payment carrier khác -> allPayment rỗng
    expect(report.allPayment).toHaveLength(0);
    expect(report.totals.totalPayment).toBe(0);
  });

  it("khớp theo prefix trước dấu '-' (BCBS)", () => {
    const report = buildHealthStatementReport({
      carrier: "BCBS",
      monthReport: "2024-06",
      healthMart: [policy({ primary_member_id: "M100" })],
      payments: [payment({ customer_id: "M100-01" })],
    });
    expect(report.paymentForProducer).toHaveLength(1);
    expect(report.totals.used).toBe(100);
  });

  it("base policy không payment -> dòng producer carriers_messer_paid = 0", () => {
    const report = buildHealthStatementReport({
      carrier: "BCBS",
      monthReport: "2024-06",
      healthMart: [policy({})],
      payments: [],
    });
    expect(report.paymentForProducer).toHaveLength(1);
    expect(report.paymentForProducer[0].carriers_messer_paid).toBe(0);
    expect(report.totals.totalPayment).toBe(0);
  });

  it("loại base policy có effective_date >= đầu tháng report", () => {
    const report = buildHealthStatementReport({
      carrier: "BCBS",
      monthReport: "2024-06",
      // effective 2024-06-05 >= 2024-06-01 -> bị loại khỏi base policy
      healthMart: [policy({ broker_effective_date: "2024-06-05" })],
      payments: [payment({})],
    });
    expect(report.paymentForProducer).toHaveLength(0);
    // payment không khớp policy nào còn lại -> unclaimed
    expect(report.unclaimedPayment).toHaveLength(1);
  });

  it("loại payment có paid_to_date sau cuối tháng report", () => {
    const report = buildHealthStatementReport({
      carrier: "BCBS",
      monthReport: "2024-06",
      healthMart: [policy({})],
      payments: [payment({ paid_to_date: "2024-07-15" })],
    });
    // Payment quá hạn -> không match policy, nhưng vẫn thuộc allPayment & unclaimed.
    // Base policy không match -> producer paid=0 (vẫn tạo dòng).
    expect(report.paymentForProducer).toHaveLength(1);
    expect(report.paymentForProducer[0].carriers_messer_paid).toBe(0);
    expect(report.totals.totalPayment).toBe(100);
    expect(report.unclaimedPayment).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { buildPcStatementReport } from "@/lib/automation/pc-statement/report";
import type { PcCleanPaymentRow } from "@/lib/automation/pc-statement/payment-parser";
import type { PcStatementPolicyRow } from "@/lib/automation/pc-statement/policy-source";

// Golden-master: khoá behavior reconciliation + tính hoa hồng pc-statement.

function policyRow(over: Partial<PcStatementPolicyRow>): PcStatementPolicyRow {
  return {
    sourceRowNumber: 1,
    isNewPolicy: true,
    agent: "JOHN",
    agency: "TWFG",
    insuredName: "INSURED A",
    address: "ADDR",
    type: "AUTO",
    company: "CARRIER",
    policyNumber: "POL-1",
    paymentPlan: "FULL",
    premium: "1000",
    effectiveDate: "2024-05-01",
    expiredDate: "2025-05-01",
    rawValues: [],
    ...over,
  };
}

function paymentRow(over: Partial<PcCleanPaymentRow>): PcCleanPaymentRow {
  return {
    insured: "INSURED A",
    policyNo: "POL-1",
    policyExp: "2025-05-01",
    commissionablePremium: 1000,
    carrierRate: 0.1,
    company: "CARRIER",
    agency: "TWFG",
    ...over,
  };
}

describe("buildPcStatementReport - commission split", () => {
  it("TWFG + agent thường: VP=80%, partner=75% của VP, EPS override=25% của VP", () => {
    const report = buildPcStatementReport({
      newPolicies: [policyRow({ agent: "JOHN", agency: "TWFG" })],
      basePolicies: [],
      payments: [paymentRow({})],
    });

    expect(report.policyInMonth).toHaveLength(1);
    const row = report.policyInMonth[0];
    // premium*rate = 1000*0.1 = 100
    expect(row.total_comission).toBe(100);
    // VP TWFG 80% = 80
    expect(row.VP_TWFG_80_Comm_DP_to_EPS_75_Comm).toBe(80);
    // partner (không Fiona) = VP * 0.75 = 60
    expect(row.Partner_Comm_75_Phuong_Comm_60).toBe(60);
    // EPS override = VP * 0.25 = 20
    expect(row.EPS_25_Override_EPS_40_PROD_Override).toBe(20);
  });

  it("TWFG + Fiona: partner=60% của VP, EPS override=40% của VP", () => {
    const report = buildPcStatementReport({
      newPolicies: [policyRow({ agent: "Fiona", agency: "TWFG" })],
      basePolicies: [],
      payments: [paymentRow({})],
    });
    const row = report.policyInMonth[0];
    expect(row.VP_TWFG_80_Comm_DP_to_EPS_75_Comm).toBe(80);
    // Fiona partner = VP*0.6 = 48
    expect(row.Partner_Comm_75_Phuong_Comm_60).toBe(48);
    // Fiona override = VP*0.4 = 32
    expect(row.EPS_25_Override_EPS_40_PROD_Override).toBe(32);
  });

  it("DP agency: VP=75%", () => {
    const report = buildPcStatementReport({
      newPolicies: [policyRow({ agency: "DP" })],
      basePolicies: [],
      payments: [paymentRow({ agency: "DP" })],
    });
    const row = report.policyInMonth[0];
    expect(row.total_comission).toBe(100);
    expect(row.VP_TWFG_80_Comm_DP_to_EPS_75_Comm).toBe(75);
  });
});

describe("buildPcStatementReport - phân loại flow", () => {
  it("payment khớp policy mới -> policyInMonth (flow 1)", () => {
    const report = buildPcStatementReport({
      newPolicies: [policyRow({ policyNumber: "POL-1" })],
      basePolicies: [],
      payments: [paymentRow({ policyNo: "POL-1" })],
    });
    expect(report.policyInMonth).toHaveLength(1);
    expect(report.additionalPolicy).toHaveLength(0);
    expect(report.unclaimedPayment).toHaveLength(0);
    expect(report.feePayment).toHaveLength(0);
  });

  it("payment khớp base policy (không phải policy mới) -> additionalPolicy (flow 2)", () => {
    const report = buildPcStatementReport({
      newPolicies: [],
      basePolicies: [policyRow({ policyNumber: "POL-9", isNewPolicy: false })],
      payments: [paymentRow({ policyNo: "POL-9" })],
    });
    expect(report.policyInMonth).toHaveLength(0);
    expect(report.additionalPolicy).toHaveLength(1);
    expect(report.unclaimedPayment).toHaveLength(0);
  });

  it("payment không khớp policy nào, rate thấp -> unclaimed (flow 3)", () => {
    const report = buildPcStatementReport({
      newPolicies: [],
      basePolicies: [],
      payments: [paymentRow({ policyNo: "ZZZ", carrierRate: 0.1 })],
    });
    expect(report.unclaimedPayment).toHaveLength(1);
    expect(report.feePayment).toHaveLength(0);
  });

  it("payment rate>=0.5 không khớp -> fee (flow 4)", () => {
    const report = buildPcStatementReport({
      newPolicies: [],
      basePolicies: [],
      payments: [paymentRow({ policyNo: "ZZZ", carrierRate: 1 })],
    });
    expect(report.unclaimedPayment).toHaveLength(0);
    expect(report.feePayment).toHaveLength(1);
  });
});

describe("buildPcStatementReport - totals & balanced", () => {
  it("tính total và balanced khi mọi payment được dùng", () => {
    const report = buildPcStatementReport({
      newPolicies: [policyRow({ policyNumber: "POL-1" })],
      basePolicies: [],
      payments: [paymentRow({ policyNo: "POL-1", commissionablePremium: 1000 })],
    });
    expect(report.totals.totalPayment).toBe(1000);
    expect(report.totals.basePolicy).toBe(1000);
    expect(report.totals.final).toBe(1000);
    expect(report.totals.balanced).toBe(true);
  });

  it("gộp payment trùng key cộng dồn commissionable premium", () => {
    const report = buildPcStatementReport({
      newPolicies: [],
      basePolicies: [],
      payments: [
        paymentRow({ policyNo: "ZZZ", commissionablePremium: 100, carrierRate: 0.1 }),
        paymentRow({ policyNo: "ZZZ", commissionablePremium: 50, carrierRate: 0.1 }),
      ],
    });
    // cùng key -> gộp thành 1 dòng clean payment với amount 150
    expect(report.unclaimedPayment).toHaveLength(1);
    expect(report.unclaimedPayment[0].true_premium).toBe(150);
    expect(report.totals.totalPayment).toBe(150);
  });
});

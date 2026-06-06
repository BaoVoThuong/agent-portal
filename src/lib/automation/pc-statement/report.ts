import type { PcCleanPaymentRow } from "./payment-parser";
import type { PcStatementPolicyRow } from "./policy-source";

export type PcCleanPaymentReportRow = {
  insured: string;
  policy_number: string;
  expired_date: string;
  comission_amount: number | null;
  comission_rate: number | null;
  company: string;
  agency: string | null;
  payment_id: number;
};

export type PcStatementReportRow = {
  agent: string | null;
  agency: string | null;
  insured_name: string | null;
  address: string | null;
  type: string | null;
  company: string | null;
  policy_number: string | null;
  effective_date: string | null;
  expired_date: string | null;
  note: string | null;
  true_premium: number | null;
  carrier_commision_rate: number | null;
  total_comission: number | null;
  VP_TWFG_80_Comm_DP_to_EPS_75_Comm: number | null;
  Comm_Paid_Deposited_Date: string | null;
  Partner_Comm_75_Phuong_Comm_60: number | null;
  EPS_25_Override_EPS_40_PROD_Override: number | null;
  paid_producer: string | null;
  producer_note: string | null;
  payment_id: number | null;
  rn: number;
  flow_order: number;
};

export type PcStatementReport = {
  totals: {
    totalPayment: number;
    basePolicy: number;
    additional: number;
    unclaimed: number;
    final: number;
    balanced: boolean;
  };
  cleanPayment: PcCleanPaymentReportRow[];
  policyInMonth: PcStatementReportRow[];
  additionalPolicy: PcStatementReportRow[];
  unclaimedPayment: PcStatementReportRow[];
};

type PolicyRow = PcStatementPolicyRow & {
  rn: number;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizePolicyNumber(value: string | null | undefined) {
  return normalizeText(value)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[.,;]+$/g, "");
}

function normalizeAgency(value: string | null | undefined) {
  return normalizeText(value).toUpperCase();
}

function normalizeAgent(value: string | null | undefined) {
  return normalizeText(value).toUpperCase();
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function parseDateTime(value: string | null | undefined) {
  const text = normalizeText(value);
  if (!text) return Number.NaN;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime();

  const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!mdy) return Number.NaN;

  const month = Number(mdy[1]);
  const day = Number(mdy[2]);
  const year = Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]);
  return Date.UTC(year, month - 1, day);
}

function sumPremium(rows: Array<{ true_premium?: number | null }>) {
  return roundMoney(
    rows.reduce((total, row) => total + Number(row.true_premium ?? 0), 0)
  );
}

function splitPolicyTokens(value: string | null | undefined) {
  return normalizeText(value)
    .split(/[\\/\n\r,;]+/g)
    .map(normalizePolicyNumber)
    .filter(Boolean);
}

function policyMatchScore(
  policyNumber: string | null,
  paymentPolicyNumber: string | null
) {
  const policy = normalizeText(policyNumber);
  const payment = normalizeText(paymentPolicyNumber);
  if (!policy || !payment) return 0;

  const normalizedPolicy = normalizePolicyNumber(policy);
  const normalizedPayment = normalizePolicyNumber(payment);

  if (!normalizedPolicy || !normalizedPayment) return 0;
  if (normalizedPolicy === normalizedPayment) return 1000;

  const policyTokens = splitPolicyTokens(policy);
  const paymentTokens = splitPolicyTokens(payment);

  if (
    policyTokens.includes(normalizedPayment) ||
    paymentTokens.includes(normalizedPolicy)
  ) {
    return 800;
  }

  if (
    policyTokens.some((token) => normalizedPayment.includes(token)) ||
    paymentTokens.some((token) => normalizedPolicy.includes(token))
  ) {
    return 500;
  }

  return normalizedPayment.includes(normalizedPolicy) ||
    normalizedPolicy.includes(normalizedPayment)
    ? 300
    : 0;
}

function commissionValues({
  agency,
  agent,
  premium,
  rate,
  includeProducerSplit,
}: {
  agency: string | null;
  agent: string | null;
  premium: number | null;
  rate: number | null;
  includeProducerSplit: boolean;
}) {
  if (premium === null || rate === null) {
    return {
      totalComission: null,
      vpCommission: null,
      partnerCommission: null,
      epsOverride: null,
    };
  }

  const totalComission = roundMoney(premium * rate);
  const agencyKey = normalizeAgency(agency);
  const vpCommission =
    agencyKey === "TWFG"
      ? roundMoney(premium * rate * 0.8)
      : agencyKey === "DP"
        ? roundMoney(premium * rate * 0.75)
        : null;

  if (!includeProducerSplit) {
    return {
      totalComission,
      vpCommission,
      partnerCommission: null,
      epsOverride: null,
    };
  }

  const isFiona = normalizeAgent(agent) === "FIONA";

  return {
    totalComission,
    vpCommission,
    partnerCommission: isFiona
      ? roundMoney(premium * rate * 0.8 * 0.6)
      : roundMoney(premium * rate * 0.8 * 0.75),
    epsOverride: isFiona
      ? roundMoney(premium * rate * 0.8 * 0.4)
      : roundMoney(premium * rate * 0.8 * 0.25),
  };
}

function buildStatementRow({
  flowOrder,
  payment,
  policy,
  rn,
}: {
  flowOrder: number;
  payment: PcCleanPaymentReportRow | null;
  policy: PolicyRow | null;
  rn: number;
}): PcStatementReportRow {
  const agency = policy?.agency ?? payment?.agency ?? null;
  const agent = policy?.agent ?? null;
  const truePremium = payment?.comission_amount ?? null;
  const carrierRate = payment?.comission_rate ?? null;
  const values = commissionValues({
    agency,
    agent,
    premium: truePremium,
    rate: carrierRate,
    includeProducerSplit: Boolean(policy),
  });

  return {
    agent,
    agency,
    insured_name: policy?.insuredName ?? payment?.insured ?? null,
    address: policy?.address ?? null,
    type: policy?.type ?? null,
    company: policy?.company ?? payment?.company ?? null,
    policy_number: policy?.policyNumber ?? payment?.policy_number ?? null,
    effective_date: policy?.effectiveDate ?? null,
    expired_date: payment?.expired_date ?? policy?.expiredDate ?? null,
    note: null,
    true_premium: truePremium,
    carrier_commision_rate: carrierRate,
    total_comission: values.totalComission,
    VP_TWFG_80_Comm_DP_to_EPS_75_Comm: values.vpCommission,
    Comm_Paid_Deposited_Date: null,
    Partner_Comm_75_Phuong_Comm_60: values.partnerCommission,
    EPS_25_Override_EPS_40_PROD_Override: values.epsOverride,
    paid_producer: null,
    producer_note: null,
    payment_id: payment?.payment_id ?? null,
    rn,
    flow_order: flowOrder,
  };
}

function groupPayments(payments: PcCleanPaymentRow[]) {
  const grouped = new Map<string, PcCleanPaymentReportRow>();

  for (const payment of payments) {
    if (!payment.insured && !payment.policyNo && !payment.policyExp) continue;

    const key = [
      payment.insured,
      payment.policyNo,
      payment.policyExp,
      payment.carrierRate ?? "",
      payment.company,
      payment.agency ?? "",
    ].join("\u001f");
    const current = grouped.get(key);
    const amount = Number(payment.commissionablePremium ?? 0);

    if (current) {
      current.comission_amount = roundMoney(
        Number(current.comission_amount ?? 0) + amount
      );
      continue;
    }

    grouped.set(key, {
      insured: payment.insured,
      policy_number: payment.policyNo,
      expired_date: payment.policyExp,
      comission_amount: roundMoney(amount),
      comission_rate:
        payment.carrierRate === null ? null : roundMoney(payment.carrierRate),
      company: payment.company,
      agency: payment.agency,
      payment_id: 0,
    });
  }

  return Array.from(grouped.values())
    .sort((a, b) => {
      const policyCompare = normalizeText(a.policy_number).localeCompare(
        normalizeText(b.policy_number)
      );
      return policyCompare === 0
        ? normalizeText(a.expired_date).localeCompare(normalizeText(b.expired_date))
        : policyCompare;
    })
    .map((payment, index) => ({ ...payment, payment_id: index + 1 }));
}

function assignPaymentsToPolicies(
  policies: PolicyRow[],
  payments: PcCleanPaymentReportRow[]
) {
  const assignments = new Map<number, PcCleanPaymentReportRow[]>();

  policies.forEach((policy) => assignments.set(policy.rn, []));

  for (const payment of payments) {
    let best:
      | {
          policy: PolicyRow;
          policyIndex: number;
          policyLength: number;
          score: number;
        }
      | null = null;

    for (let policyIndex = 0; policyIndex < policies.length; policyIndex++) {
      const policy = policies[policyIndex];
      const score = policyMatchScore(policy.policyNumber, payment.policy_number);
      if (score <= 0) continue;

      const policyLength = normalizePolicyNumber(policy.policyNumber).length;

      if (
        !best ||
        score > best.score ||
        (score === best.score && policyLength < best.policyLength) ||
        (score === best.score &&
          policyLength === best.policyLength &&
          policyIndex < best.policyIndex)
      ) {
        best = {
          policy,
          policyIndex,
          policyLength,
          score,
        };
      }
    }

    if (!best) continue;

    assignments.get(best.policy.rn)?.push(payment);
  }

  assignments.forEach((paymentsForPolicy) => {
    paymentsForPolicy.sort((a, b) => a.payment_id - b.payment_id);
  });

  return assignments;
}

function buildNewPolicyFlow(
  policies: PcStatementPolicyRow[],
  payments: PcCleanPaymentReportRow[]
) {
  const rows: PcStatementReportRow[] = [];
  const policiesWithRn = policies.map((policy, index) => ({
    ...policy,
    rn: index + 1,
  }));
  const assignments = assignPaymentsToPolicies(policiesWithRn, payments);

  policiesWithRn.forEach((policy) => {
    const matches = assignments.get(policy.rn) ?? [];

    if (matches.length === 0) {
      rows.push(
        buildStatementRow({
          flowOrder: 1,
          payment: null,
          policy,
          rn: policy.rn,
        })
      );
      return;
    }

    matches.forEach((payment) => {
      rows.push(
        buildStatementRow({
          flowOrder: 1,
          payment,
          policy,
          rn: policy.rn,
        })
      );
    });
  });

  return rows;
}

function dedupeBasePolicies(policies: PcStatementPolicyRow[]) {
  const latest = new Map<string, PcStatementPolicyRow>();

  for (const policy of policies) {
    const key = normalizeText(policy.policyNumber);
    if (!key) continue;

    const current = latest.get(key);
    const currentDate = parseDateTime(current?.effectiveDate);
    const nextDate = parseDateTime(policy.effectiveDate);

    if (!current || Number.isNaN(currentDate) || nextDate > currentDate) {
      latest.set(key, policy);
    }
  }

  return Array.from(latest.values())
    .sort((a, b) =>
      normalizeText(b.policyNumber).localeCompare(normalizeText(a.policyNumber))
    )
    .map((policy, index) => ({ ...policy, rn: index + 1 }));
}

function buildAdditionalPolicyFlow({
  offset,
  payments,
  policies,
}: {
  offset: number;
  payments: PcCleanPaymentReportRow[];
  policies: PolicyRow[];
}) {
  const rows: PcStatementReportRow[] = [];
  const assignments = assignPaymentsToPolicies(policies, payments);

  policies.forEach((policy) => {
    const matches = assignments.get(policy.rn) ?? [];

    matches.forEach((payment) => {
      rows.push(
        buildStatementRow({
          flowOrder: 2,
          payment,
          policy,
          rn: offset + policy.rn,
        })
      );
    });
  });

  return rows;
}

function buildUnclaimedFlow({
  offset,
  payments,
}: {
  offset: number;
  payments: PcCleanPaymentReportRow[];
}) {
  return payments
    .map((payment, index) =>
      buildStatementRow({
        flowOrder: 3,
        payment,
        policy: null,
        rn: offset + index + 1,
      })
    )
    .filter(
      (row) =>
        row.carrier_commision_rate !== null && row.carrier_commision_rate < 0.5
    );
}

function usedPaymentIds(rows: PcStatementReportRow[]) {
  return new Set(
    rows
      .map((row) => row.payment_id)
      .filter((paymentId): paymentId is number => paymentId !== null)
  );
}

export function buildPcStatementReport({
  basePolicies,
  newPolicies,
  payments,
}: {
  basePolicies: PcStatementPolicyRow[];
  newPolicies: PcStatementPolicyRow[];
  payments: PcCleanPaymentRow[];
}): PcStatementReport {
  const cleanPayment = groupPayments(payments);
  const policyInMonth = buildNewPolicyFlow(newPolicies, cleanPayment);
  const usedInNewPolicy = usedPaymentIds(policyInMonth);
  const unusedPayment = cleanPayment.filter(
    (payment) => !usedInNewPolicy.has(payment.payment_id)
  );
  const basePolicy = dedupeBasePolicies(basePolicies);
  const additionalPolicy = buildAdditionalPolicyFlow({
    offset: policyInMonth.length,
    payments: unusedPayment,
    policies: basePolicy,
  });
  const usedInAdditional = usedPaymentIds(additionalPolicy);
  const unusedPaymentV2 = unusedPayment.filter(
    (payment) => !usedInAdditional.has(payment.payment_id)
  );
  const unclaimedPayment = buildUnclaimedFlow({
    offset: policyInMonth.length + additionalPolicy.length,
    payments: unusedPaymentV2,
  });
  const totalPayment = roundMoney(
    cleanPayment.reduce(
      (total, row) => total + Number(row.comission_amount ?? 0),
      0
    )
  );
  const basePolicyTotal = sumPremium(policyInMonth);
  const additional = sumPremium(additionalPolicy);
  const unclaimed = sumPremium(unclaimedPayment);
  const final = roundMoney(basePolicyTotal + additional + unclaimed);

  return {
    totals: {
      totalPayment,
      basePolicy: basePolicyTotal,
      additional,
      unclaimed,
      final,
      balanced: roundMoney(final - totalPayment) === 0,
    },
    cleanPayment: cleanPayment.filter((payment) => normalizeText(payment.policy_number)),
    policyInMonth,
    additionalPolicy,
    unclaimedPayment,
  };
}

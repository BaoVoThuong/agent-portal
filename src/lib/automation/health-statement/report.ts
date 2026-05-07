import type { PaymentSummaryRow } from "./types";

export type HealthMartRow = {
  agent: string | null;
  deal_number: number | null;
  deal_name: string | null;
  carrier: string | null;
  state: string | null;
  plan_name: string | null;
  primary_member_id: string | null;
  broker_effective_date: string | null;
  report_month: string | null;
};

export type ProducerPaymentRow = HealthMartRow & {
  carriers_messer_paid: number | null;
  paid_to_date: string | null;
  transaction_id: string | null;
  statement: string | null;
};

export type DuplicatePaymentRow = {
  transaction_id: string;
  carriers_messer_paid: number;
  duplicate_count: number;
};

export type HealthStatementReport = {
  totals: {
    totalPayment: number;
    used: number;
    unclaimed: number;
    duplicate: number;
    final: number;
    balanced: boolean;
  };
  allPayment: PaymentSummaryRow[];
  paymentForProducer: ProducerPaymentRow[];
  unclaimedPayment: PaymentSummaryRow[];
  duplicatedPayment: DuplicatePaymentRow[];
};

type FinalTempRow = HealthMartRow & {
  carriers_messer_paid: number | null;
  paid_to_date: string | null;
  transaction_id: string | null;
  statement: string | null;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeId(value: string | null | undefined) {
  return normalizeText(value).split("-")[0]?.trim().toUpperCase() ?? "";
}

function parseDate(value: string | null | undefined) {
  const text = normalizeText(value);
  if (!text) return null;

  const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]);
    return new Date(Date.UTC(year, month - 1, day));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatMonthKey(value: string | null | undefined) {
  const text = normalizeText(value);
  if (!text) return "";

  const ymd = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (ymd) return `${ymd[2]}-${ymd[1]}`;

  const mdy = text.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
  if (mdy) return `${mdy[1].padStart(2, "0")}-${mdy[2]}`;

  const my = text.match(/^(\d{1,2})-(\d{4})$/);
  if (my) return `${my[1].padStart(2, "0")}-${my[2]}`;

  return text;
}

function parseMonthReport(monthReport: string) {
  const parts = monthReport.split("-");
  if (parts.length !== 2) return null;

  if (parts[0].length === 4) {
    return { year: Number(parts[0]), month: Number(parts[1]) };
  }

  return { year: Number(parts[1]), month: Number(parts[0]) };
}

function previousMonthKey(monthReport: string) {
  const parsed = parseMonthReport(monthReport);
  if (!parsed?.year || !parsed.month) return "";
  const date = new Date(Date.UTC(parsed.year, parsed.month - 2, 1));
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${mm}-${date.getUTCFullYear()}`;
}

function targetEndDate(monthReport: string) {
  const parsed = parseMonthReport(monthReport);
  if (!parsed?.year || !parsed.month) return new Date(Number.NaN);
  return new Date(Date.UTC(parsed.year, parsed.month, 0));
}

function targetMonthStartDate(monthReport: string) {
  const parsed = parseMonthReport(monthReport);
  if (!parsed?.year || !parsed.month) return new Date(Number.NaN);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
}

function paymentMatchesPolicy(payment: PaymentSummaryRow, policy: HealthMartRow) {
  const paymentId = normalizeId(payment.customer_id);
  const policyId = normalizeId(policy.primary_member_id);
  if (!paymentId || !policyId) return false;
  return (
    paymentId === policyId ||
    policyId.includes(paymentId) ||
    paymentId.includes(policyId)
  );
}

function sumMoney(rows: Array<{ gross_compensation?: number | null }>) {
  return roundMoney(
    rows.reduce((total, row) => total + Number(row.gross_compensation ?? 0), 0)
  );
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function joinValues(values: Array<string | null>) {
  const cleaned = values.map(normalizeText).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(" - ") : null;
}

function groupKey(row: HealthMartRow) {
  return [
    row.agent,
    row.deal_number,
    row.deal_name,
    row.carrier,
    row.state,
    row.plan_name,
    row.primary_member_id,
    row.broker_effective_date,
  ]
    .map((value) => normalizeText(String(value ?? "")))
    .join("\u001f");
}

function dedupeBasePolicyByEffectiveDate(
  policies: HealthMartRow[],
  monthReport: string
) {
  const targetStartDate = targetMonthStartDate(monthReport);
  const latestByPolicy = new Map<string, HealthMartRow>();

  for (const policy of policies) {
    const policyId = normalizeId(policy.primary_member_id);
    const effectiveDate = parseDate(policy.broker_effective_date);
    if (!policyId || !effectiveDate || effectiveDate >= targetStartDate) {
      continue;
    }

    const current = latestByPolicy.get(policyId);
    const currentEffectiveDate = parseDate(current?.broker_effective_date);
    if (!current || !currentEffectiveDate || effectiveDate > currentEffectiveDate) {
      latestByPolicy.set(policyId, policy);
    }
  }

  return Array.from(latestByPolicy.values());
}

export function buildHealthStatementReport({
  carrier,
  monthReport,
  healthMart,
  payments,
}: {
  carrier: string;
  monthReport: string;
  healthMart: HealthMartRow[];
  payments: PaymentSummaryRow[];
}): HealthStatementReport {
  const carrierKey = carrier.trim().toUpperCase();
  const targetMonthMinusOne = previousMonthKey(monthReport);
  const endDate = targetEndDate(monthReport);

  const allPayment = payments.filter(
    (payment) => normalizeText(payment.carrier_name).toUpperCase() === carrierKey
  );

  const basePolicy = dedupeBasePolicyByEffectiveDate(
    healthMart.filter(
      (policy) =>
        normalizeText(policy.carrier).toUpperCase() === carrierKey &&
        formatMonthKey(policy.report_month) === targetMonthMinusOne
    ),
    monthReport
  );

  const paymentData = allPayment.filter((payment) => {
    const paidDate = parseDate(payment.paid_to_date);
    if (!paidDate || paidDate > endDate) return false;
    return basePolicy.some((policy) => paymentMatchesPolicy(payment, policy));
  });

  const finalTemp: FinalTempRow[] = [];
  for (const policy of basePolicy) {
    const matches = paymentData.filter((payment) =>
      paymentMatchesPolicy(payment, policy)
    );

    if (matches.length === 0) {
      finalTemp.push({
        ...policy,
        carriers_messer_paid: null,
        paid_to_date: null,
        transaction_id: null,
        statement: null,
      });
      continue;
    }

    for (const payment of matches) {
      finalTemp.push({
        ...policy,
        carriers_messer_paid: payment.gross_compensation,
        paid_to_date: payment.paid_to_date,
        transaction_id: payment.transaction_id,
        statement: payment.statement,
      });
    }
  }

  const grouped = new Map<string, FinalTempRow[]>();
  for (const row of finalTemp) {
    const key = groupKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const paymentForProducer: ProducerPaymentRow[] = Array.from(grouped.values())
    .map((rows) => {
      const first = rows[0];
      return {
        agent: first.agent,
        deal_number: first.deal_number,
        deal_name: first.deal_name,
        carrier: first.carrier,
        state: first.state,
        plan_name: first.plan_name,
        primary_member_id: first.primary_member_id,
        broker_effective_date: first.broker_effective_date,
        report_month: first.report_month,
        carriers_messer_paid: roundMoney(
          rows.reduce(
            (total, row) => total + Number(row.carriers_messer_paid ?? 0),
            0
          )
        ),
        paid_to_date: joinValues(rows.map((row) => row.paid_to_date)),
        transaction_id: joinValues(rows.map((row) => row.transaction_id)),
        statement: joinValues(rows.map((row) => row.statement)),
      };
    })
    .sort((a, b) => normalizeText(a.agent).localeCompare(normalizeText(b.agent)));

  const claimedTransactions = new Set(
    paymentForProducer
      .flatMap((row) => normalizeText(row.transaction_id).split("-"))
      .map((transaction) => transaction.trim())
      .filter(Boolean)
  );

  const unclaimedPayment = allPayment.filter((payment) => {
    const transactionId = normalizeText(payment.transaction_id);
    return transactionId && !claimedTransactions.has(transactionId);
  });

  const duplicateMap = new Map<string, FinalTempRow[]>();
  for (const row of finalTemp) {
    const transactionId = normalizeText(row.transaction_id);
    if (!transactionId) continue;
    duplicateMap.set(transactionId, [...(duplicateMap.get(transactionId) ?? []), row]);
  }

  const duplicatedPayment = Array.from(duplicateMap.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([transactionId, rows]) => ({
      transaction_id: transactionId,
      carriers_messer_paid: roundMoney(
        rows.reduce(
          (total, row) => total + Number(row.carriers_messer_paid ?? 0),
          0
        ) / rows.length
      ),
      duplicate_count: rows.length,
    }));

  const totalPayment = sumMoney(allPayment);
  const used = roundMoney(
    paymentForProducer.reduce(
      (total, row) => total + Number(row.carriers_messer_paid ?? 0),
      0
    )
  );
  const unclaimed = sumMoney(unclaimedPayment);
  const duplicate = roundMoney(
    duplicatedPayment.reduce(
      (total, row) => total + Number(row.carriers_messer_paid ?? 0),
      0
    )
  );
  const final = roundMoney(used + unclaimed - duplicate);

  return {
    totals: {
      totalPayment,
      used,
      unclaimed,
      duplicate,
      final,
      balanced: roundMoney(totalPayment - used - unclaimed - duplicate) === 0,
    },
    allPayment,
    paymentForProducer,
    unclaimedPayment,
    duplicatedPayment,
  };
}

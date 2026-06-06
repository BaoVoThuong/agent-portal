import type {
  PcCleanPaymentReportRow,
  PcStatementReportRow,
} from "./report";

export const CLEAN_PAYMENT_HEADERS = [
  "insured",
  "policy_number",
  "expired_date",
  "comission_amount",
  "comission_rate",
  "company",
];

export const STATEMENT_HEADERS = [
  "agent",
  "agency",
  "insured_name",
  "address",
  "type",
  "company",
  "policy_number",
  "effective_date",
  "expired_date",
  "note",
  "true_premium",
  "carrier_commision_rate",
  "total_comission",
  "VP_TWFG_80_Comm_DP_to_EPS_75_Comm",
  "Comm_Paid_Deposited_Date",
  "Partner_Comm_75_Phuong_Comm_60",
  "EPS_25_Override_EPS_40_PROD_Override",
  "paid_producer",
  "producer_note",
];

export function cleanPaymentValues(row: PcCleanPaymentReportRow) {
  return [
    row.insured,
    row.policy_number,
    row.expired_date,
    row.comission_amount,
    row.comission_rate,
    row.company,
  ];
}

export function statementValues(row: PcStatementReportRow) {
  return [
    row.agent,
    row.agency,
    row.insured_name,
    row.address,
    row.type,
    row.company,
    row.policy_number,
    row.effective_date,
    row.expired_date,
    row.note,
    row.true_premium,
    row.carrier_commision_rate,
    row.total_comission,
    row.VP_TWFG_80_Comm_DP_to_EPS_75_Comm,
    row.Comm_Paid_Deposited_Date,
    row.Partner_Comm_75_Phuong_Comm_60,
    row.EPS_25_Override_EPS_40_PROD_Override,
    row.paid_producer,
    row.producer_note,
  ];
}

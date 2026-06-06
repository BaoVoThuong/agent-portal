import type {
  DuplicatePaymentRow,
  ProducerPaymentRow,
} from "./report";
import type { PaymentSummaryRow } from "./types";

export const HEALTH_PAYMENT_HEADERS = [
  "Agent",
  "Carrier_Name",
  "Customer_ID",
  "Customer_Name",
  "Effective_Date",
  "Paid_To_Date",
  "Carriers_Messer_Paid",
  "Transaction_ID",
  "Statement",
];

export const HEALTH_PRODUCER_HEADERS = [
  "Agent",
  "Num_Client",
  "Deal_Name",
  "Carrier",
  "State",
  "Plan_Name",
  "Primary_Member_ID",
  "Broker_Effective_Date",
  "Carriers_Messer_Paid",
  "Paid_To_Date",
  "Transaction_ID",
  "Statement",
];

export const HEALTH_DUPLICATE_HEADERS = [
  "Transaction_ID",
  "Carriers_Messer_Paid",
  "Duplicate_Count",
];

export function healthPaymentValues(row: PaymentSummaryRow) {
  return [
    row.agent,
    row.carrier_name,
    row.customer_id,
    row.customer_name,
    row.effective_date,
    row.paid_to_date,
    row.gross_compensation,
    row.transaction_id,
    row.statement,
  ];
}

export function healthProducerValues(row: ProducerPaymentRow) {
  return [
    row.agent,
    row.deal_number,
    row.deal_name,
    row.carrier,
    row.state,
    row.plan_name,
    row.primary_member_id,
    row.broker_effective_date,
    row.carriers_messer_paid,
    row.paid_to_date,
    row.transaction_id,
    row.statement,
  ];
}

export function healthDuplicateValues(row: DuplicatePaymentRow) {
  return [
    row.transaction_id,
    row.carriers_messer_paid,
    row.duplicate_count,
  ];
}

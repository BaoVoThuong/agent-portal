export type PaymentSummaryRow = {
  agent: string | null;
  carrier_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  effective_date: string | null;
  paid_to_date: string | null;
  gross_compensation: number | null;
  transaction_id: string | null;
  statement: string | null;
};

export type HealthStatementInput = {
  statementNumber: string;
  carrier: string;
  monthReport: string;
};

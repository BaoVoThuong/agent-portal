const { cleanText } = require("../lib/transform");

module.exports = {
  name: "health-mart",
  table: "health_raw_data",
  sheetId: "1tVJEcK-DIfaaOtH1ZYKovgKK-H6GBgeHIKPFgXSPjYk",
  gid: "167479012",
  onConflict: "source_sheet_id,source_gid,source_row_number",
  clearBeforeSync: true,
  batchSize: 500,
  columns: [
    { source: "deal_name", target: "deal_name", aliases: ["Deal name"] },
    { source: "deal_stage", target: "deal_stage", aliases: ["Deal stage"] },
    { source: "state", target: "state", aliases: ["State"] },
    { source: "carrier", target: "carrier", aliases: ["Carrier"] },
    { source: "plan_name", target: "plan_name", aliases: ["Plan name"] },
    {
      source: "primary_member_id",
      target: "primary_member_id",
      aliases: ["Primary member ID"],
    },
    { source: "agent", target: "agent", aliases: ["Agent"] },
    {
      source: "broker_effective",
      target: "broker_effective",
      aliases: ["Broker Effective"],
    },
    {
      source: "paid_to_date",
      target: "paid_to_date",
      aliases: ["Paid To Date", "Paid-To Date"],
    },
    { source: "month_report", target: "month_report", aliases: ["Month_Report"] },
    {
      source: "carriers_messer_paid",
      target: "carriers_messer_paid",
      aliases: ["Carriers Messer Paid", "Carriers / Messer Paid"],
    },
    {
      source: "agent_received",
      target: "agent_received",
      aliases: ["Agent Received"],
    },
    { source: "eps_override", target: "eps_override", aliases: ["EPS Override"] },
    {
      source: "eps_override_received",
      target: "eps_override_received",
      aliases: ["EPS Override Received"],
    },
    { source: "eps_split", target: "eps_split", aliases: ["EPS Split"] },
    { source: "pay_rate_level", target: "pay_rate_level", aliases: ["Pay Rate Level"] },
    { source: "transaction_id", target: "transaction_id", aliases: ["Transaction ID"] },
    {
      source: "messer_statement",
      target: "messer_statement",
      aliases: ["Messer Statement"],
    },
    { source: "num_client", target: "num_client", aliases: ["num_client"] },
  ].map((column) => ({
    parse: cleanText,
    ...column,
  })),
  afterSyncRpc: "refresh_health_mart",
};

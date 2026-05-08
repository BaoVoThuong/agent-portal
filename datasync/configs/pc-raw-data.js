const { cleanText } = require("../lib/transform");

module.exports = {
  name: "pc-raw-data",
  table: "pc_raw_data",
  sheetId: "1ByO8MDhCUiBO_QVhxsDHR55ixw6AxL_gq-ghwgbgJXI",
  gid: "1247736899",
  onConflict: "source_sheet_id,source_gid,source_row_number",
  clearBeforeSync: true,
  batchSize: 500,
  columns: [
    { source: "agent", target: "agent", aliases: ["Agent"] },
    { source: "agency", target: "agency", aliases: ["Agency"] },
    { source: "insured_name", target: "insured_name", aliases: ["Insured Name"] },
    { source: "zipcode", target: "zipcode", aliases: ["Zipcode", "Zip Code"] },
    { source: "type", target: "type", aliases: ["Type"] },
    { source: "company", target: "company", aliases: ["Company"] },
    {
      source: "policy_number",
      target: "policy_number",
      aliases: ["Policy Number"],
    },
    { source: "premium", target: "premium", aliases: ["Premium"] },
    {
      source: "true_premium",
      target: "true_premium",
      aliases: ["True Premium"],
    },
    {
      source: "effective_date",
      target: "effective_date",
      aliases: ["Effective Date"],
    },
    {
      source: "expired_date",
      target: "expired_date",
      aliases: ["Expired Date", "Expiration Date"],
    },
    {
      source: "carrier_commission",
      target: "carrier_commission",
      aliases: ["Carrier Commission"],
    },
    {
      source: "paid_producer",
      target: "paid_producer",
      aliases: ["Paid Producer"],
    },
    {
      source: "statement_number",
      target: "statement_number",
      aliases: ["Statement Number"],
    },
  ].map((column) => ({
    parse: cleanText,
    ...column,
  })),
  afterSyncRpc: "refresh_pc_mart",
};

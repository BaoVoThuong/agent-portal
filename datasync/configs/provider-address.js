const { cleanText } = require("../lib/transform");

module.exports = {
  name: "provider-address",
  table: "provider_address",
  sheetId: "1dRv2GA8km_b-xLFfy6LViaRGjwMMTqIRKdCDQ9IXk2A",
  gid: "1148421946",
  onConflict: "source_sheet_id,source_gid,source_row_number",
  clearBeforeSync: true,
  batchSize: 500,
  columns: [
    { source: "facility", target: "facility", aliases: ["Facility"] },
    { source: "doctors", target: "doctors", aliases: ["Doctors"] },
    { source: "npi", target: "npi", aliases: ["NPI"] },
    {
      source: "practices_as",
      target: "practices_as",
      aliases: ["Practices As"],
    },
    {
      source: "accepting_new_patients",
      target: "accepting_new_patients",
      aliases: ["Accepting New Patients"],
    },
    {
      source: "business_hours",
      target: "business_hours",
      aliases: ["Business Hours"],
    },
    { source: "phone", target: "phone", aliases: ["Phone"] },
    { source: "street", target: "street", aliases: ["Street"] },
    { source: "city", target: "city", aliases: ["City"] },
    { source: "state", target: "state", aliases: ["State"] },
    { source: "zip_code", target: "zip_code", aliases: ["Zip Code"] },
    { source: "obamacare", target: "obamacare", aliases: ["ObamaCare"] },
    { source: "medicare", target: "medicare", aliases: ["Medicare"] },
    { source: "other_plans", target: "other_plans", aliases: ["Other Plans"] },
    { source: "verified_by", target: "verified_by", aliases: ["Verified By"] },
    { source: "date", target: "date", aliases: ["Date"] },
  ].map((column) => ({
    parse: cleanText,
    ...column,
  })),
};

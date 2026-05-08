async function fetchSheetCsv(sheetId, gid) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/export`);
  url.searchParams.set("format", "csv");
  url.searchParams.set("gid", gid);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Sheet returned HTTP ${response.status}`);
  }

  return response.text();
}

module.exports = {
  fetchSheetCsv,
};

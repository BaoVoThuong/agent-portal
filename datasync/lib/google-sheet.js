async function fetchSheetCsv(sheetId, gid) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/export`);
  url.searchParams.set("format", "csv");
  url.searchParams.set("gid", gid);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Sheet returned HTTP ${response.status}`);
  }

  // A sheet that is no longer shared answers 200 with a Google sign-in page.
  // Parsed as CSV it would replace the synced table with junk rows, so anything
  // but CSV fails the sync instead.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/csv")) {
    throw new Error(`Google Sheet returned ${contentType || "no content type"} instead of CSV`);
  }

  return response.text();
}

module.exports = {
  fetchSheetCsv,
};

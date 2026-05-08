const crypto = require("node:crypto");

function cleanText(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  return text === "" ? null : text;
}

function parseInteger(value) {
  const text = cleanText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isInteger(number) ? number : null;
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rawRowFromHeaders(headers, row) {
  const raw = {};
  headers.forEach((header, columnIndex) => {
    raw[header] = cleanText(row[columnIndex]);
  });
  return raw;
}

function mapColumns(raw, columns) {
  const record = {};
  for (const column of columns) {
    const parser = column.parse ?? cleanText;
    const sources = [column.source, ...(column.aliases ?? [])];
    const source = sources.find((name) => Object.prototype.hasOwnProperty.call(raw, name));
    record[column.target] = parser(source ? raw[source] : null);
  }
  return record;
}

function rowToRecord({ config, headers, row, rowIndex, syncedAt }) {
  const raw = rawRowFromHeaders(headers, row);
  return {
    source_sheet_id: config.sheetId,
    source_gid: config.gid,
    source_row_number: rowIndex + 2,
    source_row_hash: hashJson(raw),
    ...mapColumns(raw, config.columns),
    raw_row: raw,
    synced_at: syncedAt,
  };
}

module.exports = {
  cleanText,
  parseInteger,
  rowToRecord,
};

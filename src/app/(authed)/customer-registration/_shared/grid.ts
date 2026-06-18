// Phần dùng chung GIỐNG HỆT giữa EntryGrid (health) và PcEntryGrid (P&C):
// theme, style cell, sinh _key, parse 1 dòng CSV, normalize link.
// KHÔNG generic hoá column/modal/payload — những phần đó khác nhau theo domain
// nên giữ riêng ở mỗi grid để tránh lệch UI.
import { themeQuartz, type CellStyle } from "ag-grid-community";

export const gridTheme = themeQuartz.withParams({
  accentColor: "#15345f",
  borderColor: "#d8dee7",
  browserColorScheme: "light",
  columnBorder: true,
  fontFamily: "Arial, Helvetica, sans-serif",
  foregroundColor: "#16233a",
  headerBackgroundColor: "#f7f9fc",
  headerFontWeight: 700,
  oddRowBackgroundColor: "#fbfcfe",
  rowBorder: true,
  wrapperBorderRadius: 0,
});

export const rowNumberCellStyle: CellStyle = {
  color: "#667085",
  fontSize: "10px",
  textAlign: "center",
  padding: "0",
};

export const actionCellStyle: CellStyle = { border: "none" };

// Sinh _key ổn định cho draft row (ưu tiên crypto.randomUUID, fallback Math.random).
export function makeDraftKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

// Parse 1 dòng CSV xử lý dấu phẩy trong ngoặc kép (giống logic gốc của cả 2 grid).
export function parseCsvLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

export function normalizeLink(value: unknown) {
  const href = String(value ?? "").trim();
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  return `https://${href}`;
}

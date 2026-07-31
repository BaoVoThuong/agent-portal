import * as XLSX from "xlsx";

export function writeXlsx(header: string[], rows: string[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
}

export function readSheetRows(buffer: Buffer): string[][] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  return rows.map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
  );
}

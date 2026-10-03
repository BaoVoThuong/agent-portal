import * as XLSX from "xlsx";

export type SpreadsheetContents = {
  /** Sheet đã đọc — file nhiều sheet thì là sheet khớp mẫu nhất. */
  sheetName: string;
  /** Dòng đầu tiên, đã trim, bỏ ô rỗng. */
  headers: string[];
  /** Mỗi dòng dữ liệu là một object theo tiêu đề; ô trống là null. */
  records: Record<string, unknown>[];
  /**
   * Số dòng Excel của từng record (tiêu đề = 1). SheetJS bỏ dòng trống ở giữa,
   * nên `index + 2` sẽ lệch khỏi dòng người dùng nhìn thấy trong file.
   */
  rowNumbers: number[];
};

/**
 * Đọc MỘT sheet của file Excel/CSV — dùng chung cho dialog (client) và route
 * Import (server), để hai bên không đọc cùng một file ra hai thứ.
 *
 * File nhiều sheet: chọn sheet có `scoreHeaders` cao nhất (Import chấm theo số
 * cột khớp mẫu). File "Mid-Autumn Festival 0926.xlsx" có sheet đầu là danh sách
 * hãng, dữ liệu nằm ở sheet thứ hai — chỉ đọc sheet đầu là báo "không đúng mẫu".
 * Không sheet nào có điểm thì lấy sheet đầu, như trước.
 *
 * `codepage: 65001` là bắt buộc: CSV xuất từ Google Sheets là UTF-8, nhưng
 * SheetJS mặc định đọc CSV theo latin1 — "Bé gái" thành "BÃ© gÃ¡i". File xlsx
 * tự mang mã hoá nên không bị ảnh hưởng.
 */
export function readSpreadsheet(
  data: ArrayBuffer,
  scoreHeaders?: (headers: string[]) => number,
): SpreadsheetContents {
  const workbook = XLSX.read(data, { type: "array", codepage: 65001 });
  if (workbook.SheetNames.length === 0) throw new Error("That file has no sheets.");

  const headersOf = (sheet: XLSX.WorkSheet) =>
    (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })[0] ?? [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);

  let sheetName = workbook.SheetNames[0];
  if (scoreHeaders && workbook.SheetNames.length > 1) {
    let bestScore = 0;
    for (const name of workbook.SheetNames) {
      const score = scoreHeaders(headersOf(workbook.Sheets[name]));
      if (score > bestScore) {
        bestScore = score;
        sheetName = name;
      }
    }
  }

  const sheet = workbook.Sheets[sheetName];
  const headers = headersOf(sheet);
  if (headers.length === 0) {
    throw new Error("The first row must contain column headers.");
  }
  // Khoá của record là tiêu đề THÔ ("Phone Number " còn dấu cách); cắt cho khớp
  // với `headers` đã trim, nếu không cột đó đọc ra toàn null.
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const records = raw.map((record) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key.trim(), value])),
  );
  // `__rowNum__` là thuộc tính ẩn SheetJS gắn vào mỗi record (đếm từ 0).
  const rowNumbers = raw.map((record, index) => {
    const rowNum = (record as { __rowNum__?: unknown }).__rowNum__;
    return typeof rowNum === "number" ? rowNum + 1 : index + 2;
  });
  return { sheetName, headers, records, rowNumbers };
}

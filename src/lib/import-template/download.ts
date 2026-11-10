import type { DataValidation } from "exceljs";
import {
  columnLetter,
  templateFingerprint,
  TEMPLATE_DATA_SHEET,
  TEMPLATE_LISTS_SHEET,
  TEMPLATE_META_SHEET,
  type ImportTemplateSpec,
} from "./spec";

const REQUIRED_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
} as const;

/**
 * Ghi file mẫu có dropdown thật (Data validation) và tải về.
 *
 * Dùng exceljs vì SheetJS bản cộng đồng không ghi được Data validation. Tải
 * thư viện lúc bấm nút chứ không đưa vào bundle trang.
 *
 * Giá trị dropdown nằm ở sheet ẩn `Lists` thay vì viết thẳng trong công thức:
 * Excel giới hạn danh sách viết thẳng ở 255 ký tự, danh sách người hay Specialty
 * vượt mức đó.
 */
export async function buildImportTemplateWorkbook(
  spec: ImportTemplateSpec,
): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const data = book.addWorksheet(TEMPLATE_DATA_SHEET, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const lists = book.addWorksheet(TEMPLATE_LISTS_SHEET, { state: "veryHidden" });
  const meta = book.addWorksheet(TEMPLATE_META_SHEET, { state: "veryHidden" });

  // Chỉ có dòng tiêu đề: dòng ví dụ làm người điền rối (có file chép nguyên giá
  // trị mẫu cho mọi dòng). Cột Required tô vàng CẢ CỘT — style của cột, nên ô
  // trống bên dưới cũng vàng — để thấy ngay phải điền gì.
  data.addRow(spec.columns.map((column) => column.header));
  data.getRow(1).font = { bold: true };
  spec.columns.forEach((column, index) => {
    const sheetColumn = data.getColumn(index + 1);
    sheetColumn.width = Math.min(40, Math.max(14, column.header.length + 4));
    if (column.required) sheetColumn.fill = REQUIRED_FILL;
  });

  let listIndex = 0;
  const lastRow = spec.rows + 1;
  spec.columns.forEach((column, index) => {
    const values = column.dropdown?.values ?? [];
    if (!column.dropdown || values.length === 0) return;
    const listColumn = columnLetter(listIndex);
    listIndex += 1;
    values.forEach((value, row) => {
      lists.getCell(`${listColumn}${row + 1}`).value = value;
    });
    const dataColumn = columnLetter(index);
    // `dataValidations.add` nhận cả vùng ("C2:C1001") — có trong exceljs 4.4
    // (lib/doc/data-validations.js) nhưng thiếu trong file .d.ts.
    (
      data as unknown as {
        dataValidations: { add(range: string, validation: DataValidation): void };
      }
    ).dataValidations.add(`${dataColumn}2:${dataColumn}${lastRow}`, {
      type: "list",
      allowBlank: true,
      formulae: [`${TEMPLATE_LISTS_SHEET}!$${listColumn}$1:$${listColumn}$${values.length}`],
      showErrorMessage: true,
      errorStyle: column.dropdown.allowOther ? "warning" : "stop",
      errorTitle: column.header,
      error: column.dropdown.allowOther
        ? "This value is not in the list. Separate several values with a comma."
        : "Pick a value from the list.",
    });
  });

  meta.getCell("A1").value = spec.kind;
  meta.getCell("B1").value = templateFingerprint(spec);

  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadImportTemplate(
  spec: ImportTemplateSpec,
  fileName: string,
): Promise<void> {
  const buffer = await buildImportTemplateWorkbook(spec);
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

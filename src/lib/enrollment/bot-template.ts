import type { TableColumn } from "@/lib/table-config/types";
import { buildImportTemplateWorkbook, type TemplateDataRow } from "@/lib/import-template/download";
import { TEMPLATE_DATA_SHEET } from "@/lib/import-template/spec";
import {
  buildEnrollmentTemplateSpec,
  importableEnrollmentColumns,
  parseEnrollmentImportRows,
  toIsoDate,
  type EnrollmentHeaderMatch,
} from "@/lib/enrollment/import";

/**
 * File đã sửa của Slack bot, đúng y file mẫu Import (Bảo chốt 2026-11-15: "convert
 * giống 100% file template, không có bất kì thay đổi nào"). Dựng bằng đúng hàm của
 * nút Download template (`buildEnrollmentTemplateSpec` + `buildImportTemplateWorkbook`):
 * cùng sheet Data, cùng cột và thứ tự, dropdown, cột Required tô vàng, dấu phiên bản.
 * Dữ liệu lấy theo cột đã khớp; ô ngày ghi YYYY-MM-DD như file mẫu.
 *
 * Dòng Import sẽ bỏ qua KHÔNG bị bỏ khỏi file (Bảo chốt cùng ngày): chúng nằm cuối
 * file, cả dòng đỏ nhạt, ô cần sửa / cần điền đỏ đậm kèm ghi chú lý do.
 *
 * File mẫu không có cột ID (chỉ để THÊM hồ sơ), nên file có Record ID (cập nhật hồ
 * sơ cũ) không chuyển được: trả `unavailable`, bot giữ file đã sửa như cũ.
 */
export type BotTemplateResult =
  | { sheet: string; file_base64: string; problem_rows: { row: number; reason: string }[] }
  | { unavailable: string };

/** Lỗi của một dòng trong file gốc: nhãn cột cần sửa + lý do. */
export type RowProblem = { labels: string[]; reasons: string[] };

/** Nhãn cột trong một câu lỗi của Import: "Carrier: unknown…", "FUB Link, Agent required.", "Missing Client Name". */
export function labelsFromReason(reason: string): string[] {
  const text = reason.trim();
  if (text === "Missing Client Name") return ["Client Name"];
  const required = /^(.+) required\.$/.exec(text);
  if (required) return required[1].split(",").map((label) => label.trim()).filter(Boolean);
  const prefixed = /^([^:]+):/.exec(text);
  return prefixed ? [prefixed[1].trim()] : [];
}

/**
 * Mọi ô sai của một dòng. Đọc dòng chỉ báo lỗi ĐẦU TIÊN, nên xoá ô vừa tìm ra rồi đọc
 * lại, tới khi hết lỗi đọc dòng. Lỗi thiếu cột Required (`requiredReason`) cộng thêm.
 */
export function rowProblem(input: {
  record: Record<string, unknown>;
  rowNumber: number;
  firstReason: string | null;
  requiredReason: string | null;
  matched: EnrollmentHeaderMatch;
  columns: readonly TableColumn[];
  context: Parameters<typeof parseEnrollmentImportRows>[3];
}): RowProblem {
  const labels: string[] = [];
  const reasons: string[] = [];
  const headerByLabel = new Map<string, string>();
  for (const [header, key] of input.matched.byHeader) {
    const column = input.columns.find((c) => c.key === key);
    if (column) headerByLabel.set(column.label, header);
  }
  let record = { ...input.record };
  let reason = input.firstReason;
  for (let guard = 0; reason && guard < input.columns.length; guard += 1) {
    reasons.push(reason);
    const found = labelsFromReason(reason).filter((label) => !labels.includes(label));
    if (found.length === 0) break;
    labels.push(...found);
    for (const label of found) {
      const header = headerByLabel.get(label);
      if (header) record = { ...record, [header]: null };
    }
    const again = parseEnrollmentImportRows([record], input.matched, input.columns, input.context, [input.rowNumber]);
    const next = again.skipped[0]?.reason ?? null;
    // "Missing Client Name" sinh ra do chính mình vừa xoá ô Client Name: dừng.
    reason = next && !(next === "Missing Client Name" && labels.includes("Client Name")) ? next : null;
  }
  // Cột Required để trống. Import chỉ kiểm việc này với dòng đọc được, nên dòng đã
  // lỗi ở trên sẽ không báo — kiểm luôn ở đây để tô đủ mọi ô cần điền.
  const missing = importableEnrollmentColumns(input.columns).filter((column) => {
    if (!column.required || labels.includes(column.label)) return false;
    const header = [...input.matched.byHeader].find(([, key]) => key === column.key)?.[0];
    const value = header ? input.record[header] : null;
    return value === null || value === undefined || String(value).trim() === "";
  });
  if (missing.length > 0) {
    labels.push(...missing.map((column) => column.label));
    reasons.push(`${missing.map((column) => column.label).join(", ")} required.`);
  }
  if (input.requiredReason) {
    const extra = labelsFromReason(input.requiredReason).filter((label) => !labels.includes(label));
    if (extra.length > 0 || labelsFromReason(input.requiredReason).length === 0) {
      reasons.push(input.requiredReason);
      labels.push(...extra);
    }
  }
  return { labels, reasons };
}

/** Lỗi của mọi dòng, theo số dòng Excel của file gốc. */
export function collectRowProblems(input: {
  records: readonly Record<string, unknown>[];
  rowNumbers: readonly number[];
  skipped: readonly { row: number; reason: string }[];
  failed: readonly { row: number; error: string }[];
  matched: EnrollmentHeaderMatch;
  columns: readonly TableColumn[];
  context: Parameters<typeof parseEnrollmentImportRows>[3];
}): Map<number, RowProblem> {
  const firstReason = new Map(input.skipped.map((entry) => [entry.row, entry.reason]));
  const laterReason = new Map(input.failed.map((entry) => [entry.row, entry.error]));
  const problems = new Map<number, RowProblem>();
  input.records.forEach((record, index) => {
    const rowNumber = input.rowNumbers[index]!;
    const problem = rowProblem({
      record,
      rowNumber,
      firstReason: firstReason.get(rowNumber) ?? null,
      requiredReason: laterReason.get(rowNumber) ?? null,
      matched: input.matched,
      columns: input.columns,
      context: input.context,
    });
    if (problem.reasons.length > 0) problems.set(rowNumber, problem);
  });
  return problems;
}

export async function fillEnrollmentTemplate(input: {
  program: string;
  columns: readonly TableColumn[];
  options: Parameters<typeof buildEnrollmentTemplateSpec>[2];
  columnOptions: Parameters<typeof buildEnrollmentTemplateSpec>[3];
  people: Parameters<typeof buildEnrollmentTemplateSpec>[4];
  matched: EnrollmentHeaderMatch;
  records: readonly Record<string, unknown>[];
  /** Số dòng Excel của từng record (cùng thứ tự `records`). */
  rowNumbers: readonly number[];
  /** Lỗi theo số dòng Excel của file gốc. */
  problems: ReadonlyMap<number, RowProblem>;
}): Promise<BotTemplateResult> {
  if (input.matched.idHeader) {
    return { unavailable: "The file updates existing records (Record ID); the template has no ID column." };
  }
  const spec = buildEnrollmentTemplateSpec(input.program, input.columns, input.options, input.columnOptions, input.people);
  const importable = importableEnrollmentColumns(input.columns);
  const headerByKey = new Map<string, string>();
  for (const [header, key] of input.matched.byHeader) headerByKey.set(key, header);

  const toRow = (record: Record<string, unknown>, problem: RowProblem | undefined): TemplateDataRow => ({
    values: importable.map((column) => {
      const header = headerByKey.get(column.key);
      if (!header) return null;
      const value = record[header] ?? null;
      if (column.type === "date") {
        const date = toIsoDate(value);
        return typeof date === "string" ? date : value;
      }
      return value;
    }),
    ...(problem
      ? {
          problem: {
            cells: importable.flatMap((column, index) => (problem.labels.includes(column.label) ? [index] : [])),
            note: problem.reasons.join("\n"),
          },
        }
      : {}),
  });

  const good: TemplateDataRow[] = [];
  const bad: { row: TemplateDataRow; reason: string }[] = [];
  input.records.forEach((record, index) => {
    const problem = input.problems.get(input.rowNumbers[index]!);
    if (problem) bad.push({ row: toRow(record, problem), reason: problem.reasons.join("; ") });
    else good.push(toRow(record, undefined));
  });

  const buffer = Buffer.from(await buildImportTemplateWorkbook(spec, [...good, ...bad.map((entry) => entry.row)]));
  return {
    sheet: TEMPLATE_DATA_SHEET,
    file_base64: buffer.toString("base64"),
    // Số dòng trong file MỚI (dòng 1 là tiêu đề), để danh sách lỗi trên Slack khớp file.
    problem_rows: bad.map((entry, index) => ({ row: good.length + index + 2, reason: entry.reason })),
  };
}

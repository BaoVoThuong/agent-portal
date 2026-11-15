import { NextResponse } from "next/server";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import { buildTaskActor } from "@/lib/tasks/access";
import { canAccessEnrollment } from "@/lib/enrollment/access";
import { canActorImport } from "@/lib/table-config/export-access";
import { parseEnrollmentProgram } from "@/lib/enrollment/types";
import { fetchEnrollmentOptionData } from "@/lib/enrollment/options";
import { fetchEnrollmentPeople } from "@/lib/enrollment/queries";
import { fetchTableColumnOptions, fetchTableColumns } from "@/lib/table-config/queries";
import {
  ENROLLMENT_IMPORT_MAX_ROWS,
  buildEnrollmentImportContext,
  enrollmentImportPayload,
  importHeaderLabel,
  matchEnrollmentHeaders,
  parseEnrollmentImportRows,
  recordsFromMatrix,
} from "@/lib/enrollment/import";
import { processEnrollmentImportRows } from "@/lib/enrollment/import-rows";
import { collectRowProblems, fillEnrollmentTemplate } from "@/lib/enrollment/bot-template";

/** Trần thô cho cả ma trận (dòng trống tính luôn); giới hạn thật là ENROLLMENT_IMPORT_MAX_ROWS dòng có dữ liệu. */
const MAX_MATRIX_ROWS = 20_000;

/**
 * Import Enrollment cho Slack bot (2026-11-14 chạy thử, 2026-11-15 thêm import thật).
 *
 * Đọc file giống hệt dialog import (recordsFromMatrix → matchEnrollmentHeaders →
 * parseEnrollmentImportRows) rồi chạy processEnrollmentImportRows — đúng đường của
 * import thật. Quyền kiểm theo actor_email (account portal của người yêu cầu) để kết
 * quả giống hệt khi chính người đó bấm Import. `dryRun: false` chỉ được gọi sau khi
 * một người có quyền Approve bấm duyệt trong Slack (route /api/slack-bot/actions).
 * Chạy thử với `fill_template: true` trả kèm file mẫu Import đã điền dữ liệu
 * (lib/enrollment/bot-template.ts), để bot đăng và import đúng file đó.
 */
export async function runBotEnrollmentImport(raw: unknown, options: { dryRun: boolean }): Promise<NextResponse> {
  const { dryRun } = options;
  const body = raw as {
    program?: unknown;
    actor_email?: unknown;
    rows?: unknown;
    first_row?: unknown;
    fill_template?: unknown;
  } | null;
  const program = parseEnrollmentProgram(body?.program);
  if (!program) return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  const actorEmail = typeof body?.actor_email === "string" ? body.actor_email.trim().toLowerCase() : "";
  if (!actorEmail) return NextResponse.json({ error: "actor_email is required." }, { status: 400 });
  if (!Array.isArray(body?.rows) || !body.rows.every(Array.isArray)) {
    return NextResponse.json({ error: "rows must be the sheet as an array of rows." }, { status: 400 });
  }
  // Chặn thô theo kích thước ma trận (kể cả dòng trống) để không phải đọc một
  // payload khổng lồ; giới hạn THẬT đếm dòng có dữ liệu, ngay sau recordsFromMatrix.
  if (body.rows.length > MAX_MATRIX_ROWS) {
    return NextResponse.json({ error: "That sheet is too large." }, { status: 400 });
  }

  const access = await getUserAccessByEmail(actorEmail);
  if (access.unavailable) return NextResponse.json({ error: "Could not check access. Try again." }, { status: 503 });
  if (!access.isActive) return NextResponse.json({ error: "No active portal account for this person." }, { status: 403 });
  const actor = buildTaskActor(access.permissions, actorEmail);
  if (!canAccessEnrollment(actor) || !canActorImport(access.permissions)) {
    return NextResponse.json({ error: "This person does not have permission to import." }, { status: 403 });
  }

  let sheet: ReturnType<typeof recordsFromMatrix>;
  try {
    const firstRow = typeof body.first_row === "number" && Number.isInteger(body.first_row) && body.first_row >= 1 ? body.first_row : 1;
    sheet = recordsFromMatrix(body.rows as unknown[][], firstRow);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unreadable sheet." }, { status: 400 });
  }
  if (sheet.records.length > ENROLLMENT_IMPORT_MAX_ROWS) {
    return NextResponse.json({ error: `At most ${ENROLLMENT_IMPORT_MAX_ROWS} rows per import.` }, { status: 400 });
  }

  const [columns, columnOptions, optionData, people] = await Promise.all([
    fetchTableColumns(program),
    fetchTableColumnOptions(program),
    fetchEnrollmentOptionData(program),
    fetchEnrollmentPeople(),
  ]);
  const context = buildEnrollmentImportContext(optionData.options, people, columnOptions);
  const matched = matchEnrollmentHeaders(sheet.headers, columns, sheet.records);
  const parsed = parseEnrollmentImportRows(sheet.records, matched, columns, context, sheet.rowNumbers);

  const outcome = await processEnrollmentImportRows({
    program,
    actorEmail,
    dryRun,
    rows: parsed.rows.map((row) => ({
      row: row.row,
      id: row.id,
      body: enrollmentImportPayload(row.values, columns),
    })),
  });
  if (!outcome.ok) return outcome.response;

  let template: Awaited<ReturnType<typeof fillEnrollmentTemplate>> | undefined;
  if (dryRun && body.fill_template === true) {
    const problems = collectRowProblems({
      records: sheet.records,
      rowNumbers: sheet.rowNumbers,
      skipped: parsed.skipped,
      failed: outcome.result.failed,
      matched,
      columns,
      context,
    });
    template = await fillEnrollmentTemplate({
      program,
      columns,
      options: optionData.options,
      columnOptions,
      people,
      matched,
      records: sheet.records,
      rowNumbers: sheet.rowNumbers,
      problems,
    });
  }

  return NextResponse.json({
    ...(template ? { template } : {}),
    header_matches: {
      matched: [...matched.byHeader].map(([header, key]) => ({ header: importHeaderLabel(header), key })),
      id_header: matched.idHeader ? importHeaderLabel(matched.idHeader) : null,
      ignored: matched.ignored,
      managed: matched.managed,
    },
    skipped: parsed.skipped,
    ...outcome.result,
  });
}

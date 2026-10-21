import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { parsePcPaymentWorkbook } from "@/lib/automation/pc-statement/payment-parser";
import {
  mappingRequiredResponse,
  readPcMappings,
} from "@/lib/automation/pc-statement/request-mappings";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  parseWorkbooksSequentially,
  validateWorkbookUploads,
} from "@/lib/automation/workbook-upload";

export const runtime = "nodejs";

const PREVIEW_LIMIT = 20;

export async function POST(request: Request) {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.AUTOMATION_PC_STATEMENT)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);

  if (files.length === 0) {
    return NextResponse.json(
      { error: "At least one payment XLSX file is required" },
      { status: 400 }
    );
  }

  const uploadValidation = validateWorkbookUploads(files);
  if (!uploadValidation.ok) {
    return NextResponse.json(
      { error: uploadValidation.error },
      { status: uploadValidation.status }
    );
  }

  const mappings = readPcMappings(formData, files.length);
  if (!mappings.ok) {
    return NextResponse.json({ error: mappings.error }, { status: 400 });
  }

  let currentFile: string | undefined;
  try {
    const parsedFiles = await parseWorkbooksSequentially(files, async (file, index) => {
        currentFile = file.name;
        const buffer = Buffer.from(await file.arrayBuffer());
        const parsed = parsePcPaymentWorkbook(buffer, mappings.mappings[index]);

        return {
          fileName: file.name,
          rowCount: parsed.rows.length,
          rows: parsed.rows,
          sheets: parsed.sheets,
          warnings: parsed.warnings,
        };
      });

    const rows = parsedFiles.flatMap((file) =>
      file.rows.map((row) => ({ ...row, sourceFile: file.fileName }))
    );
    const totalPremium = rows.reduce(
      (total, row) => total + Number(row.commissionablePremium ?? 0),
      0
    );

    return NextResponse.json({
      files: parsedFiles.map(({ fileName, rowCount, sheets, warnings }) => ({
        fileName,
        rowCount,
        sheets,
        warnings,
      })),
      rowCount: rows.length,
      totalPremium: Math.round(totalPremium * 100) / 100,
      rows: rows.slice(0, PREVIEW_LIMIT),
    });
  } catch (err) {
    const mappingRequired = mappingRequiredResponse(err, currentFile);
    if (mappingRequired) return mappingRequired;
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to clean P&C payment file",
      },
      { status: 500 }
    );
  }
}

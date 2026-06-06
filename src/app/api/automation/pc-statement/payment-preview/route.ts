import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { parsePcPaymentWorkbook } from "@/lib/automation/pc-statement/payment-parser";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

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

  try {
    const parsedFiles = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        const parsed = parsePcPaymentWorkbook(buffer);

        return {
          fileName: file.name,
          rowCount: parsed.rows.length,
          rows: parsed.rows,
          sheets: parsed.sheets,
        };
      })
    );

    const rows = parsedFiles.flatMap((file) =>
      file.rows.map((row) => ({ ...row, sourceFile: file.fileName }))
    );
    const totalPremium = rows.reduce(
      (total, row) => total + Number(row.commissionablePremium ?? 0),
      0
    );

    return NextResponse.json({
      files: parsedFiles.map(({ fileName, rowCount, sheets }) => ({
        fileName,
        rowCount,
        sheets,
      })),
      rowCount: rows.length,
      totalPremium: Math.round(totalPremium * 100) / 100,
      rows: rows.slice(0, PREVIEW_LIMIT),
    });
  } catch (err) {
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

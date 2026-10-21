import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { inspectPcPaymentWorkbook } from "@/lib/automation/pc-statement/payment-parser";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  parseWorkbooksSequentially,
  validateWorkbookUploads,
} from "@/lib/automation/workbook-upload";

export const runtime = "nodejs";

/** The columns of each payment file, for the drag-to-map step. */
export async function POST(request: Request) {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.AUTOMATION_PC_STATEMENT)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);

  const uploadValidation = validateWorkbookUploads(files);
  if (!uploadValidation.ok) {
    return NextResponse.json(
      { error: uploadValidation.error },
      { status: uploadValidation.status }
    );
  }

  try {
    const inspected = await parseWorkbooksSequentially(files, async (file) => ({
      fileName: file.name,
      inspection: inspectPcPaymentWorkbook(Buffer.from(await file.arrayBuffer())),
    }));
    return NextResponse.json({ files: inspected });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read the payment file" },
      { status: 500 }
    );
  }
}

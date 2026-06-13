import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { parsePcPaymentWorkbook } from "@/lib/automation/pc-statement/payment-parser";
import { fetchPcPolicySnapshot } from "@/lib/automation/pc-statement/policy-source";
import { buildPcStatementReport } from "@/lib/automation/pc-statement/report";
import { buildPcStatementWorkbook } from "@/lib/automation/pc-statement/workbook";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";

function getFiles(formData: FormData) {
  return formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);
}

export async function POST(request: Request) {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.AUTOMATION_PC_STATEMENT)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const files = getFiles(formData);

  if (files.length === 0) {
    return NextResponse.json(
      { error: "At least one payment XLSX file is required" },
      { status: 400 }
    );
  }

  let payments;
  let policySnapshot;

  try {
    const parsedFiles = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return parsePcPaymentWorkbook(buffer).rows;
      })
    );
    payments = parsedFiles.flat();
    policySnapshot = await fetchPcPolicySnapshot();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to prepare P&C statement data",
      },
      { status: 500 }
    );
  }

  if (payments.length === 0) {
    return NextResponse.json(
      { error: "No clean payment rows were found in the uploaded file(s)" },
      { status: 422 }
    );
  }

  const report = buildPcStatementReport({
    basePolicies: policySnapshot.basePolicies,
    newPolicies: policySnapshot.newPolicies,
    payments,
  });
  const workbook = buildPcStatementWorkbook(report);

  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Disposition": 'attachment; filename="pc-statement-report.xlsx"',
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-Total-Payment": String(report.totals.totalPayment),
      "X-Base-Policy": String(report.totals.basePolicy),
      "X-Additional": String(report.totals.additional),
      "X-Unclaimed": String(report.totals.unclaimed),
      "X-Fee": String(report.totals.fee),
      "X-Final": String(report.totals.final),
      "X-Balanced": String(report.totals.balanced),
      "X-Clean-Payment-Rows": String(report.cleanPayment.length),
      "X-New-Policy-Rows": String(report.policyInMonth.length),
      "X-Additional-Rows": String(report.additionalPolicy.length),
      "X-Unclaimed-Rows": String(report.unclaimedPayment.length),
      "X-Fee-Rows": String(report.feePayment.length),
    },
  });
}

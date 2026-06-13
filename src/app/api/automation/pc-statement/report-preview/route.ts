import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { parsePcPaymentWorkbook } from "@/lib/automation/pc-statement/payment-parser";
import { fetchPcPolicySnapshot } from "@/lib/automation/pc-statement/policy-source";
import { buildPcStatementReport } from "@/lib/automation/pc-statement/report";
import {
  CLEAN_PAYMENT_HEADERS,
  STATEMENT_HEADERS,
  UNCLAIM_FEE_HEADERS,
  cleanPaymentValues,
  statementValues,
  unclaimFeeValues,
} from "@/lib/automation/pc-statement/table-data";
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

  try {
    const parsedFiles = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return parsePcPaymentWorkbook(buffer).rows;
      })
    );
    const payments = parsedFiles.flat();

    if (payments.length === 0) {
      return NextResponse.json(
        { error: "No clean payment rows were found in the uploaded file(s)" },
        { status: 422 }
      );
    }

    const policySnapshot = await fetchPcPolicySnapshot();
    const report = buildPcStatementReport({
      basePolicies: policySnapshot.basePolicies,
      newPolicies: policySnapshot.newPolicies,
      payments,
    });

    return NextResponse.json({
      totals: report.totals,
      lastBlackRow: policySnapshot.lastBlackRow,
      paymentClean: {
        count: report.cleanPayment.length,
        headers: CLEAN_PAYMENT_HEADERS,
        rows: report.cleanPayment.map((row) => ({
          values: cleanPaymentValues(row),
        })),
      },
      policyInMonth: {
        count: report.policyInMonth.length,
        headers: STATEMENT_HEADERS,
        rows: report.policyInMonth.map((row) => ({
          values: statementValues(row),
        })),
      },
      additionalPolicy: {
        count: report.additionalPolicy.length,
        headers: STATEMENT_HEADERS,
        rows: report.additionalPolicy.map((row) => ({
          values: statementValues(row),
        })),
      },
      unclaimPayment: {
        count: report.unclaimedPayment.length,
        headers: UNCLAIM_FEE_HEADERS,
        rows: report.unclaimedPayment.map((row) => ({
          values: unclaimFeeValues(row),
        })),
      },
      feePayment: {
        count: report.feePayment.length,
        headers: UNCLAIM_FEE_HEADERS,
        rows: report.feePayment.map((row) => ({
          values: unclaimFeeValues(row),
        })),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to build P&C statement preview",
      },
      { status: 500 }
    );
  }
}

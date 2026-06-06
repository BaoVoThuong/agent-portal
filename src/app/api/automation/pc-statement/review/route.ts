import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { parsePcPaymentWorkbook } from "@/lib/automation/pc-statement/payment-parser";
import { fetchPcPolicySnapshot } from "@/lib/automation/pc-statement/policy-source";
import { buildPcStatementReport } from "@/lib/automation/pc-statement/report";
import {
  CLEAN_PAYMENT_HEADERS,
  cleanPaymentValues,
} from "@/lib/automation/pc-statement/table-data";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";

const REVIEW_LIMIT = 100;

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

  try {
    const policySnapshot = await fetchPcPolicySnapshot();

    if (files.length === 0) {
      return NextResponse.json({
        totals: {
          totalPayment: 0,
          basePolicy: 0,
          additional: 0,
          unclaimed: 0,
          final: 0,
          balanced: true,
        },
        lastBlackRow: policySnapshot.lastBlackRow,
        paymentClean: {
          count: 0,
          headers: CLEAN_PAYMENT_HEADERS,
          rows: [],
        },
        oldPolicies: {
          count: policySnapshot.basePolicies.length,
          headers: policySnapshot.headers,
          rows: policySnapshot.basePolicies
            .slice(0, REVIEW_LIMIT)
            .map((row) => ({ values: row.rawValues })),
        },
        newPolicies: {
          count: policySnapshot.newPolicies.length,
          headers: policySnapshot.headers,
          rows: policySnapshot.newPolicies
            .slice(0, REVIEW_LIMIT)
            .map((row) => ({ values: row.rawValues })),
        },
      });
    }

    const parsedFiles = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return parsePcPaymentWorkbook(buffer).rows;
      })
    );
    const payments = parsedFiles.flat();
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
        rows: report.cleanPayment
          .slice(0, REVIEW_LIMIT)
          .map((row) => ({ values: cleanPaymentValues(row) })),
      },
      oldPolicies: {
        count: policySnapshot.basePolicies.length,
        headers: policySnapshot.headers,
        rows: policySnapshot.basePolicies
          .slice(0, REVIEW_LIMIT)
          .map((row) => ({ values: row.rawValues })),
      },
      newPolicies: {
        count: policySnapshot.newPolicies.length,
        headers: policySnapshot.headers,
        rows: policySnapshot.newPolicies
          .slice(0, REVIEW_LIMIT)
          .map((row) => ({ values: row.rawValues })),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to build P&C review",
      },
      { status: 500 }
    );
  }
}

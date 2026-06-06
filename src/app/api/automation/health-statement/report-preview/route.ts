import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseHealthPaymentWorkbook } from "@/lib/automation/health-statement/parser";
import {
  buildHealthStatementReport,
  type HealthMartRow,
} from "@/lib/automation/health-statement/report";
import {
  HEALTH_DUPLICATE_HEADERS,
  HEALTH_PAYMENT_HEADERS,
  HEALTH_PRODUCER_HEADERS,
  healthDuplicateValues,
  healthPaymentValues,
  healthProducerValues,
} from "@/lib/automation/health-statement/table-data";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function getRequiredText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getStatementNumbers(formData: FormData) {
  return formData
    .getAll("statementNumbers")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim());
}

function getFiles(formData: FormData) {
  return formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);
}

async function fetchHealthMartRows(carrier: string) {
  const supabase = getSupabaseAdmin();
  const rows: HealthMartRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("health_mart")
      .select(
        "agent, deal_number:num_client, deal_name, carrier, state, plan_name, primary_member_id, broker_effective_date, report_month"
      )
      .ilike("carrier", carrier)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as HealthMartRow[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

export async function POST(request: Request) {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.AUTOMATION_HEALTH_STATEMENT)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const carrier = getRequiredText(formData, "carrier").toUpperCase();
  const monthReport = getRequiredText(formData, "monthReport");
  const statementNumbers = getStatementNumbers(formData);
  const files = getFiles(formData);

  if (!carrier || !monthReport) {
    return NextResponse.json(
      { error: "Carrier and month report are required" },
      { status: 400 }
    );
  }

  if (files.length === 0 || statementNumbers.length === 0) {
    return NextResponse.json(
      { error: "At least one statement number and payment file are required" },
      { status: 400 }
    );
  }

  if (files.length !== statementNumbers.length) {
    return NextResponse.json(
      { error: "Each payment file must have one statement number" },
      { status: 400 }
    );
  }

  try {
    const parsedFiles = await Promise.all(
      files.map(async (file, index) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return parseHealthPaymentWorkbook(buffer, {
          statementNumber: statementNumbers[index],
          carrier,
          monthReport,
        });
      })
    );
    const rows = parsedFiles.flat();

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No clean payment rows were found. Check the carrier, month report, and file format.",
        },
        { status: 422 }
      );
    }

    const healthMart = await fetchHealthMartRows(carrier);
    const report = buildHealthStatementReport({
      carrier,
      monthReport,
      healthMart,
      payments: rows,
    });

    return NextResponse.json({
      totals: report.totals,
      allPayment: {
        count: report.allPayment.length,
        headers: HEALTH_PAYMENT_HEADERS,
        rows: report.allPayment.map((row) => ({
          values: healthPaymentValues(row),
        })),
      },
      paymentForProducer: {
        count: report.paymentForProducer.length,
        headers: HEALTH_PRODUCER_HEADERS,
        rows: report.paymentForProducer.map((row) => ({
          values: healthProducerValues(row),
        })),
      },
      unclaimedPayment: {
        count: report.unclaimedPayment.length,
        headers: HEALTH_PAYMENT_HEADERS,
        rows: report.unclaimedPayment.map((row) => ({
          values: healthPaymentValues(row),
        })),
      },
      duplicatedPayment: {
        count: report.duplicatedPayment.length,
        headers: HEALTH_DUPLICATE_HEADERS,
        rows: report.duplicatedPayment.map((row) => ({
          values: healthDuplicateValues(row),
        })),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to build health statement preview",
      },
      { status: 500 }
    );
  }
}

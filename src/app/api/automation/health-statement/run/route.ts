import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseHealthPaymentWorkbook } from "@/lib/automation/health-statement/parser";
import {
  buildHealthStatementReport,
  type HealthMartRow,
} from "@/lib/automation/health-statement/report";
import { buildHealthStatementWorkbook } from "@/lib/automation/health-statement/workbook";

export const runtime = "nodejs";

function getRequiredText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
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
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const carrier = getRequiredText(formData, "carrier").toUpperCase();
  const monthReport = getRequiredText(formData, "monthReport");
  const statementNumbers = formData
    .getAll("statementNumbers")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim());
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);

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

  const rows = (
    await Promise.all(
      files.map(async (file, index) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return parseHealthPaymentWorkbook(buffer, {
          statementNumber: statementNumbers[index],
          carrier,
          monthReport,
        });
      })
    )
  ).flat();

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No clean payment rows were found. Check the carrier, month report, and file format.",
      },
      { status: 422 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { error: clearError } = await supabase.rpc(
    "clear_health_payment_summary"
  );

  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 });
  }

  const { error } = await supabase.from("health_payment_summary").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let report;
  try {
    const healthMart = await fetchHealthMartRows(carrier);
    report = buildHealthStatementReport({
      carrier,
      monthReport,
      healthMart,
      payments: rows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to build health statement report",
      },
      { status: 500 }
    );
  }

  const workbook = buildHealthStatementWorkbook(report);
  const filename = `health-statement-${carrier}-${monthReport}.xlsx`;

  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-Inserted-Rows": String(rows.length),
      "X-Total-Payment": String(report.totals.totalPayment),
      "X-Used": String(report.totals.used),
      "X-Unclaimed": String(report.totals.unclaimed),
      "X-Duplicate": String(report.totals.duplicate),
      "X-Final": String(report.totals.final),
      "X-Balanced": String(report.totals.balanced),
    },
  });
}

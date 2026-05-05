import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseHealthPaymentWorkbook } from "@/lib/automation/health-statement/parser";

export const runtime = "nodejs";

function getRequiredText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
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

  return NextResponse.json({
    inserted: rows.length,
    preview: rows.slice(0, 10),
  });
}

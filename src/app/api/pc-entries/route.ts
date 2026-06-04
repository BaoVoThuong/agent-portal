import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appendPcEntriesToSheet } from "@/lib/sheets";
import type { PcEntryInput, PcEntry } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildVisibleEntriesFilter, normalizeAgentName } from "@/lib/agent-name";

const REQUIRED_PC_FIELDS = [
  "agency",
  "insured_name",
  "address",
  "type",
  "company",
  "policy_number",
  "pay_plan",
  "premium",
  "effective_date",
  "expired_date",
] as const;

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (
    !email ||
    !can(session?.user?.permissions, PERMISSIONS.CUSTOMER_REGISTRATION_PC)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canViewAll = can(
    session.user.permissions,
    PERMISSIONS.COMPANY_VIEW_ALL
  );
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("pc_entries")
    .select("*")
    .order("created_at", { ascending: false });

  if (!canViewAll) {
    query = query.or(buildVisibleEntriesFilter(email, session.user.name));
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entries: data ?? [] });
}

function sanitizeRow(row: Partial<PcEntryInput>): PcEntryInput | null {
  for (const key of REQUIRED_PC_FIELDS) {
    const value = row[key];
    if (typeof value !== "string" || value.trim() === "") return null;
  }

  return {
    selected_agent:
      typeof row.selected_agent === "string"
        ? normalizeAgentName(row.selected_agent)
        : "",
    agency: String(row.agency).trim(),
    insured_name: String(row.insured_name).trim(),
    address: String(row.address).trim(),
    type: String(row.type).trim(),
    company: String(row.company).trim(),
    policy_number: String(row.policy_number).trim(),
    pay_plan: String(row.pay_plan).trim(),
    premium: String(row.premium).trim(),
    effective_date: String(row.effective_date).trim(),
    expired_date: String(row.expired_date).trim(),
  };
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  const name = session?.user?.name ?? null;
  if (
    !email ||
    !can(session?.user?.permissions, PERMISSIONS.CUSTOMER_REGISTRATION_PC)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const rawRows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rawRows || rawRows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  const cleaned: PcEntryInput[] = [];
  for (const row of rawRows) {
    const r = sanitizeRow(row);
    if (!r) {
      return NextResponse.json(
        { error: "Some rows are missing required fields" },
        { status: 400 }
      );
    }
    cleaned.push(r);
  }

  if (cleaned.some((r) => r.selected_agent === "")) {
    return NextResponse.json(
      { error: "Agent is required" },
      { status: 400 }
    );
  }

  const toInsert = cleaned.map((r) => ({
    ...r,
    agent_email: email,
    agent_name: name,
  }));

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pc_entries")
    .insert(toInsert)
    .select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const inserted = (data ?? []) as PcEntry[];
  try {
    await appendPcEntriesToSheet(inserted);
  } catch (err) {
    console.error("P&C sheet sync failed", err);
    return NextResponse.json({
      entries: inserted,
      warning: "Saved to database but Google Sheet sync failed",
    });
  }

  return NextResponse.json({ entries: inserted });
}

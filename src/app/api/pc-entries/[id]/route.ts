import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { updatePcEntryInSheet, deletePcEntryFromSheet } from "@/lib/sheets";
import type { PcEntryInput, PcEntry } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { normalizeAgentName } from "@/lib/agent-name";

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

function canManagePcEntry(
  entry: { agent_email: string; selected_agent: string | null },
  email: string,
  name: string | null | undefined
) {
  if (entry.agent_email === email) return true;

  const agentName = normalizeAgentName(name);

  return agentName !== "" && normalizeAgentName(entry.selected_agent) === agentName;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (
    !email ||
    !can(session?.user?.permissions, PERMISSIONS.CUSTOMER_REGISTRATION_PC)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const canManageAll = can(
    session.user.permissions,
    PERMISSIONS.COMPANY_VIEW_ALL
  );

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const cleaned = sanitizeRow(body);
  if (!cleaned) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (cleaned.selected_agent === "") {
    return NextResponse.json({ error: "Agent is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("pc_entries")
    .select("agent_email, selected_agent")
    .eq("id", id)
    .single();

  if (
    !existing ||
    (!canManageAll && !canManagePcEntry(existing, email, session.user.name))
  ) {
    return NextResponse.json({ error: "Not found or forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("pc_entries")
    .update(cleaned)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const updatedEntry = data as PcEntry;

  try {
    await updatePcEntryInSheet(updatedEntry);
  } catch (err) {
    console.error("P&C sheet sync failed", err);
    return NextResponse.json({
      entry: updatedEntry,
      warning: "Updated in database but Google Sheet sync failed",
    });
  }

  return NextResponse.json({ entry: updatedEntry });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (
    !email ||
    !can(session?.user?.permissions, PERMISSIONS.CUSTOMER_REGISTRATION_PC)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const canManageAll = can(
    session.user.permissions,
    PERMISSIONS.COMPANY_VIEW_ALL
  );

  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("pc_entries")
    .select("agent_email, selected_agent")
    .eq("id", id)
    .single();

  if (
    !existing ||
    (!canManageAll && !canManagePcEntry(existing, email, session.user.name))
  ) {
    return NextResponse.json({ error: "Not found or forbidden" }, { status: 403 });
  }

  const { error } = await supabase.from("pc_entries").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await deletePcEntryFromSheet(id);
  } catch (err) {
    console.error("P&C sheet sync failed", err);
    return NextResponse.json({
      deleted: true,
      warning: "Deleted in database but Google Sheet sync failed",
    });
  }

  return NextResponse.json({ deleted: true });
}

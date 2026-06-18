import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appendEntriesToSheet } from "@/lib/sheets";
import type { EntryInput, Entry } from "@/lib/domain/entry.types";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildVisibleEntriesFilter, normalizeAgentName } from "@/lib/agent-name";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (
    !email ||
    !can(session?.user?.permissions, PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canViewAll = can(
    session.user.permissions,
    PERMISSIONS.COMPANY_VIEW_ALL
  );
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("health_entries")
    .select("*")
    .order("created_at", { ascending: false });

  if (!canViewAll) {
    // Show entries the user submitted (agent_email) OR entries someone else
    // submitted on this agent's behalf (selected_agent matches their name).
    query = query.or(buildVisibleEntriesFilter(email, session.user.name));
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entries: data ?? [] });
}

function sanitizeRow(row: Partial<EntryInput>): EntryInput | null {
  const required = [
    "carrier_name",
    "state",
    "zipcode",
    "effective_date",
    "customer_name",
    "policy_id",
  ] as const;
  for (const key of required) {
    const value = row[key];
    if (typeof value !== "string" || value.trim() === "") return null;
  }
  return {
    selected_agent:
      typeof row.selected_agent === "string"
        ? normalizeAgentName(row.selected_agent)
        : "",
    carrier_name: String(row.carrier_name).trim(),
    state: String(row.state).trim(),
    zipcode: String(row.zipcode).trim(),
    effective_date: String(row.effective_date).trim(),
    customer_name: String(row.customer_name).trim(),
    policy_id: String(row.policy_id).trim(),
    number_of_members:
      row.number_of_members === null ||
      row.number_of_members === undefined ||
      row.number_of_members === ("" as unknown as number)
        ? null
        : Number(row.number_of_members),
    fub_link: typeof row.fub_link === "string" ? row.fub_link.trim() : "",
  };
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  const name = session?.user?.name ?? null;
  if (
    !email ||
    !can(session?.user?.permissions, PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const rawRows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rawRows || rawRows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  const cleaned: EntryInput[] = [];
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
    .from("health_entries")
    .insert(toInsert)
    .select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const inserted = (data ?? []) as Entry[];
  try {
    await appendEntriesToSheet(inserted);
  } catch (err) {
    console.error("Sheet sync failed", err);
    return NextResponse.json({
      entries: inserted,
      warning: "Saved to database but Google Sheet sync failed",
    });
  }

  return NextResponse.json({ entries: inserted });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appendEntriesToSheet } from "@/lib/sheets";
import type { EntryInput, Entry } from "@/lib/domain/entry.types";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildVisibleEntriesFilter, normalizeAgentName } from "@/lib/agent-name";
import { fetchRegistrationEntries } from "@/lib/registration/queries";
import { RouteTiming } from "@/lib/server-timing";

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
    PERMISSIONS.CUSTOMER_REGISTRATION_VIEW_ALL
  );
  try {
    const entries = await fetchRegistrationEntries<Entry>(
      "health_entries",
      canViewAll ? undefined : buildVisibleEntriesFilter(email, session.user.name),
    );
    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load entries." }, { status: 500 });
  }
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
  // Đo nhánh thành công, để biết lượt ghi Google Sheet tốn bao lâu (QĐ-F của
  // plan instant feedback).
  const timing = new RouteTiming("entries-create");
  const session = await timing.measure("auth", async () => auth());
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
  const { data, error } = await timing.measure("write", async () =>
    supabase.from("health_entries").insert(toInsert).select("*")
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const inserted = (data ?? []) as Entry[];
  const respond = (body: unknown) => {
    const response = NextResponse.json(body);
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(200);
    return response;
  };
  try {
    await timing.measure("sheet", () => appendEntriesToSheet(inserted));
  } catch (err) {
    console.error("Sheet sync failed", err);
    return respond({
      entries: inserted,
      warning: "Saved to database but Google Sheet sync failed",
    });
  }

  return respond({ entries: inserted });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { updateEntryInSheet, deleteEntryFromSheet } from "@/lib/sheets";
import type { EntryInput, Entry } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

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
    carrier_name: String(row.carrier_name).trim(),
    state: String(row.state).trim(),
    zipcode: String(row.zipcode).trim(),
    effective_date: String(row.effective_date).trim(),
    customer_name: String(row.customer_name).trim(),
    policy_id: String(row.policy_id).trim(),
    number_of_members:
      row.number_of_members === null ||
      row.number_of_members === undefined ||
      String(row.number_of_members).trim() === ""
        ? null
        : Number(row.number_of_members),
    fub_link: typeof row.fub_link === "string" ? row.fub_link.trim() : "",
  };
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
    !can(session?.user?.permissions, PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH)
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

  const supabase = getSupabaseAdmin();
  
  // Verify ownership
  const { data: existing } = await supabase
    .from("entries")
    .select("agent_email")
    .eq("id", id)
    .single();

  if (!existing || (!canManageAll && existing.agent_email !== email)) {
    return NextResponse.json({ error: "Not found or forbidden" }, { status: 403 });
  }

  // Update Supabase
  const { data, error } = await supabase
    .from("entries")
    .update(cleaned)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const updatedEntry = data as Entry;

  // Sync to Sheet
  try {
    await updateEntryInSheet(updatedEntry);
  } catch (err) {
    console.error("Sheet sync failed", err);
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
    !can(session?.user?.permissions, PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const canManageAll = can(
    session.user.permissions,
    PERMISSIONS.COMPANY_VIEW_ALL
  );

  const supabase = getSupabaseAdmin();
  
  // Verify ownership
  const { data: existing } = await supabase
    .from("entries")
    .select("agent_email")
    .eq("id", id)
    .single();

  if (!existing || (!canManageAll && existing.agent_email !== email)) {
    return NextResponse.json({ error: "Not found or forbidden" }, { status: 403 });
  }

  // Delete from Supabase
  const { error } = await supabase.from("entries").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Delete from Sheet
  try {
    await deleteEntryFromSheet(id);
  } catch (err) {
    console.error("Sheet sync failed", err);
    return NextResponse.json({
      deleted: true,
      warning: "Deleted in database but Google Sheet sync failed",
    });
  }

  return NextResponse.json({ deleted: true });
}

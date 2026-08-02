import { NextResponse } from "next/server";
import { sanitizeEnrollmentPatchForProgram } from "@/lib/enrollment/program-fields";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { canApproveImport } from "@/lib/table-config/import";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";
import { isTaskAssigneesMissingError } from "@/lib/tasks/assignees";
import type { TableScope } from "@/lib/table-config/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type ImportRequestRow = {
  id: string;
  scope: TableScope;
  submitted_by_email: string;
  status: string;
  match_column_key: string;
  column_mapping: Record<string, string>;
  summary: { addCount?: number; updateCount?: number; errorCount?: number };
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  created_at: string;
};

type ImportStagingRow = {
  id: string;
  action: "add" | "update" | "error";
  target_record_id: string | null;
  values: Record<string, unknown>;
  error_text: string | null;
};

const REJECTABLE_IMPORT_STATUSES = new Set(["pending", "processing", "failed"]);

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const data = await loadImportRequest(id);
  if (!data) return NextResponse.json({ error: "Import request not found." }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const data = await loadImportRequest(id);
  if (!data) return NextResponse.json({ error: "Import request not found." }, { status: 404 });
  const approval = canApproveImport(data.request, admin.actor.email);
  if (!approval.ok) {
    return NextResponse.json({ error: approval.error }, { status: 400 });
  }
  if (data.rows.some((row) => row.action === "error")) {
    return NextResponse.json(
      { error: "Fix or reject this import. Error rows cannot be approved." },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const { data: claimed, error: claimError } = await supabase
    .from("import_request")
    .update({
      status: "processing",
      reviewed_by_email: admin.actor.email,
      reviewed_at: nowIso,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!claimed) {
    return NextResponse.json(
      { error: "Import request was already reviewed or is processing." },
      { status: 409 }
    );
  }

  try {
    for (const row of data.rows) {
      await applyImportRow(data.request.scope, row);
    }
  } catch (applyError) {
    const message =
      applyError instanceof Error ? applyError.message : "Could not apply import.";
    await supabase
      .from("import_request")
      .update({
        status: "failed",
        reject_reason: message,
        reviewed_by_email: admin.actor.email,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "processing");
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { error } = await supabase
    .from("import_request")
    .update({
      status: "approved",
      reviewed_by_email: admin.actor.email,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "processing");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastTableConfigChanged();
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { id } = await params;
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const body = await request.json().catch(() => null);
  const rejectReason =
    typeof body?.reject_reason === "string" ? body.reject_reason.trim() : "";

  const data = await loadImportRequest(id);
  if (!data) return NextResponse.json({ error: "Import request not found." }, { status: 404 });
  if (!REJECTABLE_IMPORT_STATUSES.has(data.request.status)) {
    return NextResponse.json(
      { error: "Import request cannot be rejected in its current state." },
      { status: 400 }
    );
  }
  if (
    data.request.status === "pending" &&
    data.request.submitted_by_email.trim().toLowerCase() !==
    admin.actor.email.trim().toLowerCase()
  ) {
    const approval = canApproveImport(data.request, admin.actor.email);
    if (!approval.ok) return NextResponse.json({ error: approval.error }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("import_request")
    .update({
      status: "rejected",
      reviewed_by_email: admin.actor.email,
      reviewed_at: nowIso,
      reject_reason: rejectReason || null,
    })
    .eq("id", id)
    .in("status", [...REJECTABLE_IMPORT_STATUSES]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

async function loadImportRequest(id: string): Promise<{
  request: ImportRequestRow;
  rows: ImportStagingRow[];
} | null> {
  const supabase = getSupabaseAdmin();
  const { data: request, error } = await supabase
    .from("import_request")
    .select(
      "id,scope,submitted_by_email,status,match_column_key,column_mapping,summary,reviewed_by_email,reviewed_at,reject_reason,created_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!request) return null;

  const { data: rows, error: rowError } = await supabase
    .from("import_request_row")
    .select("id,action,target_record_id,values,error_text")
    .eq("request_id", id)
    .order("created_at", { ascending: true });
  if (rowError) throw new Error(rowError.message);
  return {
    request: request as ImportRequestRow,
    rows: (rows ?? []) as ImportStagingRow[],
  };
}

async function applyImportRow(scope: TableScope, row: ImportStagingRow): Promise<void> {
  if (row.action === "error") return;
  if (scope === "cs") {
    await applyTaskImportRow(row);
  } else {
    await applyEnrollmentImportRow(scope, row);
  }
}

async function applyTaskImportRow(row: ImportStagingRow): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { systemPatch, customPatch } = splitTaskValues(row.values);
  if (row.action === "add") {
    const assigneeEmail =
      typeof systemPatch.assignee_email === "string" &&
      systemPatch.assignee_email.trim() !== ""
        ? systemPatch.assignee_email.trim()
        : null;
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: systemPatch.title ?? "Imported task",
        description: systemPatch.description ?? null,
        fub_link: systemPatch.fub_link ?? null,
        status: systemPatch.status ?? (assigneeEmail ? "todo" : "backlog"),
        priority: systemPatch.priority ?? "medium",
        category_id: systemPatch.category_id ?? null,
        agent_email: systemPatch.agent_email ?? null,
        assignee_email: assigneeEmail,
        reporter_email: systemPatch.reporter_email ?? "import",
        custom_values: customPatch,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await syncImportedTaskAssignee(supabase, (data as { id: string }).id, assigneeEmail);
    return;
  }

  if (!row.target_record_id) throw new Error("Update row is missing target_record_id.");
  const currentCustomValues = await fetchCurrentCustomValues("tasks", row.target_record_id);
  const { assignee_email: ignoredAssigneeEmail, ...updatePatch } = systemPatch;
  void ignoredAssigneeEmail;
  const { error } = await supabase
    .from("tasks")
    .update({
      ...updatePatch,
      custom_values: { ...currentCustomValues, ...customPatch },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.target_record_id);
  if (error) throw new Error(error.message);
}

async function syncImportedTaskAssignee(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  taskId: string,
  rawAssigneeEmail: unknown
): Promise<void> {
  const assigneeEmail =
    typeof rawAssigneeEmail === "string" && rawAssigneeEmail.trim() !== ""
      ? rawAssigneeEmail.trim()
      : null;
  const { error: deleteError } = await supabase
    .from("task_assignees")
    .delete()
    .eq("task_id", taskId);
  if (deleteError) {
    if (isTaskAssigneesMissingError(deleteError)) return;
    throw new Error(deleteError.message);
  }
  if (!assigneeEmail) return;

  const { error: insertError } = await supabase.from("task_assignees").insert({
    task_id: taskId,
    email: assigneeEmail,
    created_at: new Date().toISOString(),
  });
  if (insertError && !isTaskAssigneesMissingError(insertError)) {
    throw new Error(insertError.message);
  }
}

async function applyEnrollmentImportRow(
  scope: Exclude<TableScope, "cs">,
  row: ImportStagingRow
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { systemPatch, customPatch } = splitEnrollmentValues(row.values);
  if (row.action === "add") {
    const insertPatch = sanitizeEnrollmentPatchForProgram(scope, {
      program: scope,
      client_name: systemPatch.client_name ?? "Imported enrollment",
      description: systemPatch.description ?? null,
      fub_link: systemPatch.fub_link ?? null,
      due_date: systemPatch.due_date ?? null,
      stage_id: systemPatch.stage_id ?? null,
      carrier_id: systemPatch.carrier_id ?? null,
      platform_id: systemPatch.platform_id ?? null,
      consent_id: systemPatch.consent_id ?? null,
      payment_status_id: systemPatch.payment_status_id ?? null,
      aca_status_id: systemPatch.aca_status_id ?? null,
      pcp_2025: systemPatch.pcp_2025 ?? null,
      pcp_2026: systemPatch.pcp_2026 ?? null,
      caller_email: systemPatch.caller_email ?? null,
      responsible_enroll_email: systemPatch.responsible_enroll_email ?? null,
      created_by_email: "import",
      custom_values: customPatch,
    });
    const { error } = await supabase.from("enrollment_records").insert(insertPatch);
    if (error) throw new Error(error.message);
    return;
  }

  if (!row.target_record_id) throw new Error("Update row is missing target_record_id.");
  const currentCustomValues = await fetchCurrentCustomValues(
    "enrollment_records",
    row.target_record_id
  );
  const { error } = await supabase
    .from("enrollment_records")
    .update({
      ...sanitizeEnrollmentPatchForProgram(scope, systemPatch),
      custom_values: { ...currentCustomValues, ...customPatch },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.target_record_id);
  if (error) throw new Error(error.message);
}

async function fetchCurrentCustomValues(
  table: "tasks" | "enrollment_records",
  id: string
): Promise<Record<string, unknown>> {
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select("custom_values")
    .eq("id", id)
    .maybeSingle();
  if (error) return {};
  const customValues = (data as { custom_values?: unknown } | null)?.custom_values;
  return customValues && typeof customValues === "object" && !Array.isArray(customValues)
    ? (customValues as Record<string, unknown>)
    : {};
}

function splitTaskValues(values: Record<string, unknown>): {
  systemPatch: Record<string, unknown>;
  customPatch: Record<string, unknown>;
} {
  const systemPatch: Record<string, unknown> = {};
  const customPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    switch (key) {
      case "summary":
        systemPatch.title = value;
        break;
      case "description":
        systemPatch.description = value;
        break;
      case "fub":
        systemPatch.fub_link = value;
        break;
      case "status":
        systemPatch.status = value;
        break;
      case "priority":
        systemPatch.priority = value;
        break;
      case "category":
        systemPatch.category_id = value;
        break;
      case "assignee":
        systemPatch.assignee_email = value;
        break;
      case "agent":
        systemPatch.agent_email = value;
        break;
      case "reporter":
        systemPatch.reporter_email = value;
        break;
      default:
        customPatch[key] = value;
    }
  }
  return { systemPatch, customPatch };
}

function splitEnrollmentValues(values: Record<string, unknown>): {
  systemPatch: Record<string, unknown>;
  customPatch: Record<string, unknown>;
} {
  const systemPatch: Record<string, unknown> = {};
  const customPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    switch (key) {
      case "client":
        systemPatch.client_name = value;
        break;
      case "description":
        systemPatch.description = value;
        break;
      case "fub":
        systemPatch.fub_link = value;
        break;
      case "due":
        systemPatch.due_date = value;
        break;
      case "stage":
        systemPatch.stage_id = value;
        break;
      case "carrier":
        systemPatch.carrier_id = value;
        break;
      case "platform":
        systemPatch.platform_id = value;
        break;
      case "consent":
        systemPatch.consent_id = value;
        break;
      case "payment":
        systemPatch.payment_status_id = value;
        break;
      case "aca":
        systemPatch.aca_status_id = value;
        break;
      case "pcp2025":
        systemPatch.pcp_2025 = value;
        break;
      case "pcp2026":
        systemPatch.pcp_2026 = value;
        break;
      case "agent":
        systemPatch.agent_email = value;
        break;
      case "caller":
        systemPatch.caller_email = value;
        break;
      case "responsible":
        systemPatch.responsible_enroll_email = value;
        break;
      default:
        customPatch[key] = value;
    }
  }
  return { systemPatch, customPatch };
}

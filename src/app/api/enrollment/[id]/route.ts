import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  canArchiveEnrollmentRecord,
  canMutateEnrollmentRecord,
  loadEnrollmentActor,
} from "@/lib/enrollment/access";
import {
  ENROLLMENT_OPTION_LABELS,
  fetchEnrollmentOptionData,
} from "@/lib/enrollment/options";
import {
  fetchEnrollmentRecordById,
  isMissingEnrollmentDescriptionColumn,
} from "@/lib/enrollment/queries";
import {
  insertEnrollmentNotifications,
  uniqueEnrollmentNotificationRecipients,
  type EnrollmentNotificationInsertInput,
} from "@/lib/enrollment/notifications";
import {
  broadcastEnrollmentChanged,
  broadcastEnrollmentRoom,
} from "@/lib/enrollment/realtime";
import { sanitizeEnrollmentPatchForProgram } from "@/lib/enrollment/program-fields";
import { parseEnrollmentDate } from "@/lib/enrollment/dates";
import { fetchAdminEmails } from "@/lib/tasks/membership";
import {
  findMissingRequiredFields,
  missingRequiredFieldsMessage,
} from "@/lib/table-config/required";
import type {
  EnrollmentOption,
  EnrollmentOptionSetKey,
  EnrollmentRecord,
  EnrollmentRecordWithStats,
} from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
type Body = Record<string, unknown>;

const TEXT_FIELDS = [
  "client_name",
  "description",
  "fub_link",
  "pcp_2025",
  "pcp_2026",
  "agent_email",
  "caller_email",
  "responsible_enroll_email",
] as const;

const OPTION_FIELDS = {
  stage_id: "stage",
  carrier_id: "carrier",
  platform_id: "platform",
  consent_id: "consent",
  payment_status_id: "payment_status",
  aca_status_id: "aca_status",
} as const;

const KEY_STAGE_NOTIFICATIONS = new Set([
  "5-Ready to enroll",
  "11-Terminated",
]);

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const record = await fetchEnrollmentRecordById(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ record });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const expectedUpdatedAt = cleanText(body.expected_updated_at);
  if (!expectedUpdatedAt) {
    return NextResponse.json(
      { error: "expected_updated_at is required." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: currentData, error: currentError } = await supabase
    .from("enrollment_records")
    .select("*")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (currentError) {
    return NextResponse.json({ error: currentError.message }, { status: 500 });
  }
  if (!currentData) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const current = currentData as EnrollmentRecord;
  if (!canMutateEnrollmentRecord(actorResult.actor, current)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (current.updated_at !== expectedUpdatedAt) {
    return NextResponse.json(
      { error: "Enrollment record was updated by someone else. Refresh and try again." },
      { status: 409 }
    );
  }

  const { options } = await fetchEnrollmentOptionData(current.program);
  const optionById = new Map(options.map((option) => [option.id, option]));
  const patch: Record<string, unknown> = {};
  const changedFields: string[] = [];

  for (const field of TEXT_FIELDS) {
    if (!(field in body)) continue;
    const next = cleanText(body[field]);
    if (next !== current[field]) {
      patch[field] = next;
      changedFields.push(field);
    }
  }

  if ("due_date" in body) {
    const nextDueDate = parseEnrollmentDate(body.due_date);
    if (nextDueDate.error) {
      return NextResponse.json({ error: nextDueDate.error }, { status: 400 });
    }
    if (nextDueDate.value !== current.due_date) {
      patch.due_date = nextDueDate.value;
      patch.due_soon_notified_at = null;
      patch.overdue_notified_at = null;
      patch.overdue_reminded_at = null;
      changedFields.push("due_date");
    }
  }

  for (const [field, setKey] of optionEntries()) {
    if (!(field in body)) continue;
    const next = cleanText(body[field]);
    if (field === "stage_id" && !next) {
      return NextResponse.json({ error: "Stage is required." }, { status: 400 });
    }
    if (next && !isOptionInSet(optionById, next, setKey)) {
      return NextResponse.json(
        { error: `Invalid ${ENROLLMENT_OPTION_LABELS[setKey]} option.` },
        { status: 400 }
      );
    }
    if (next !== current[field]) {
      patch[field] = next;
      changedFields.push(field);
    }
  }

  const fromStage = current.stage_id ? optionById.get(current.stage_id) ?? null : null;
  const nextStageId =
    typeof patch.stage_id === "string" ? patch.stage_id : current.stage_id;
  const toStage = nextStageId ? optionById.get(nextStageId) ?? null : null;
  const stageChanged = "stage_id" in patch;
  const reopening =
    stageChanged && Boolean(fromStage?.is_terminal) && !Boolean(toStage?.is_terminal);
  const reopenReason = cleanText(body.reopen_reason);
  if (reopening && !reopenReason) {
    return NextResponse.json(
      { error: "Reopen reason is required when leaving a terminal stage." },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  if (stageChanged) {
    if (toStage?.is_terminal) {
      patch.closed_at = nowIso;
    } else {
      patch.closed_at = null;
    }

    if (toStage?.triggers_qc || !toStage?.is_terminal) {
      patch.qc_checked_by_email = null;
      patch.qc_checked_at = null;
      patch.qc_stale_notified_at = null;
    }
  }

  const qcChecked =
    typeof body.qc_checked === "boolean" ? body.qc_checked : null;
  if (qcChecked !== null) {
    if (qcChecked && !toStage?.triggers_qc) {
      return NextResponse.json(
        { error: "QC can only be checked on a stage that requires QC." },
        { status: 400 }
      );
    }
    patch.qc_checked_by_email = qcChecked ? actorResult.actor.email : null;
    patch.qc_checked_at = qcChecked ? nowIso : null;
    patch.qc_stale_notified_at = null;
    changedFields.push(qcChecked ? "qc_checked" : "qc_cleared");
  }

  if (isPlainRecord(body.custom_values)) {
    patch.custom_values = {
      ...(isPlainRecord(current.custom_values) ? current.custom_values : {}),
      ...cleanCustomValues(body.custom_values),
    };
    changedFields.push("custom_values");
  }

  // findMissingRequiredFields() keys fieldValues by table_column.key, which
  // differs from this table's own column names for most of these —
  // translate here, only including a key if `patch` actually touches the
  // matching DB field (partial: true below then only checks what this
  // specific request changes — editing an unrelated field must not be
  // blocked by some other Required field the record already has a value for).
  const requiredFieldValues: Record<string, unknown> = {};
  if ("client_name" in patch) requiredFieldValues.client = patch.client_name;
  if ("description" in patch) requiredFieldValues.description = patch.description;
  if ("fub_link" in patch) requiredFieldValues.fub = patch.fub_link;
  if ("due_date" in patch) requiredFieldValues.due = patch.due_date;
  if ("stage_id" in patch) requiredFieldValues.stage = patch.stage_id;
  if ("carrier_id" in patch) requiredFieldValues.carrier = patch.carrier_id;
  if ("platform_id" in patch) requiredFieldValues.platform = patch.platform_id;
  if ("consent_id" in patch) requiredFieldValues.consent = patch.consent_id;
  if ("payment_status_id" in patch) requiredFieldValues.payment = patch.payment_status_id;
  if ("aca_status_id" in patch) requiredFieldValues.aca = patch.aca_status_id;
  if ("pcp_2025" in patch) requiredFieldValues.pcp2025 = patch.pcp_2025;
  if ("pcp_2026" in patch) requiredFieldValues.pcp2026 = patch.pcp_2026;
  if ("agent_email" in patch) requiredFieldValues.agent = patch.agent_email;
  if ("caller_email" in patch) requiredFieldValues.caller = patch.caller_email;
  if ("responsible_enroll_email" in patch) requiredFieldValues.responsible = patch.responsible_enroll_email;
  const missingRequired = await findMissingRequiredFields(
    current.program,
    {
      fieldValues: requiredFieldValues,
      customValues: isPlainRecord(patch.custom_values) ? patch.custom_values : undefined,
      partial: true,
    },
    supabase
  );
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: missingRequiredFieldsMessage(missingRequired) },
      { status: 400 }
    );
  }

  const sanitizedPatch = sanitizeEnrollmentPatchForProgram(
    current.program,
    patch,
    current
  );

  if (Object.keys(sanitizedPatch).length === 0) {
    const canonical = await fetchEnrollmentRecordById(id);
    return NextResponse.json({
      record: canonical ?? { ...current, comment_count: 0, attachment_count: 0 },
    });
  }

  sanitizedPatch.updated_by_email = actorResult.actor.email;
  sanitizedPatch.updated_at = nowIso;

  let descriptionSkipped = false;
  let updateResult = await supabase
    .from("enrollment_records")
    .update(sanitizedPatch)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (isMissingEnrollmentDescriptionColumn(updateResult.error) && "description" in sanitizedPatch) {
    const patchWithoutDescription = { ...sanitizedPatch };
    delete patchWithoutDescription.description;
    const hasPersistableField = Object.keys(patchWithoutDescription).some(
      (key) => key !== "updated_by_email" && key !== "updated_at"
    );
    if (!hasPersistableField) {
      return NextResponse.json(
        { error: "Database migration missing: enrollment_records.description." },
        { status: 500 }
      );
    }
    descriptionSkipped = true;
    updateResult = await supabase
      .from("enrollment_records")
      .update(patchWithoutDescription)
      .eq("id", id)
      .eq("updated_at", expectedUpdatedAt)
      .select("*")
      .maybeSingle();
  }
  const { data: updatedData, error: updateError } = updateResult;
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  if (!updatedData) {
    return NextResponse.json(
      { error: "Enrollment record was updated by someone else. Refresh and try again." },
      { status: 409 }
    );
  }

  const updated = { description: null, ...updatedData } as EnrollmentRecord;
  // The canonical update is committed before audit/notification fan-out. A
  // post-commit side-effect failure must not become a retryable 5xx, or the
  // client can roll back and submit the same mutation twice. Return the
  // committed row with observable warnings until transactional repair exists.
  const mutationWarnings: string[] = [];
  const persistedChangedFields = descriptionSkipped
    ? changedFields.filter((field) => field !== "description")
    : changedFields;
  const activityRows: {
    record_id: string;
    actor_email: string;
    type: string;
    meta: Record<string, unknown> | null;
  }[] = [];
  const notifications: EnrollmentNotificationInsertInput[] = [];

  if (stageChanged) {
    const { error: stageHistoryError } = await supabase.from("enrollment_stage_history").insert({
      record_id: id,
      from_option_id: current.stage_id,
      to_option_id: updated.stage_id,
      changed_by_email: actorResult.actor.email,
      changed_at: nowIso,
    });
    if (stageHistoryError) {
      mutationWarnings.push(`enrollment_stage_history: ${stageHistoryError.message}`);
    }
    activityRows.push({
      record_id: id,
      actor_email: actorResult.actor.email,
      type: "stage_changed",
      meta: {
        from: fromStage?.label ?? "No stage",
        to: toStage?.label ?? "No stage",
      },
    });

    if (reopening) {
      activityRows.push({
        record_id: id,
        actor_email: actorResult.actor.email,
        type: "reopened",
        meta: { reason: reopenReason, from: fromStage?.label ?? "No stage" },
      });
      for (const recipient of uniqueEnrollmentNotificationRecipients(
        [updated.caller_email, updated.responsible_enroll_email],
        [actorResult.actor.email]
      )) {
        notifications.push({
          recipient_email: recipient,
          record_id: id,
          type: "reopened",
          actor_email: actorResult.actor.email,
          detail: reopenReason,
        });
      }
    } else if (toStage?.triggers_qc) {
      activityRows.push({
        record_id: id,
        actor_email: actorResult.actor.email,
        type: "qc_needed",
        meta: { stage: toStage.label },
      });
      let adminEmails: string[] = [];
      try {
        adminEmails = await fetchAdminEmails();
      } catch (error) {
        mutationWarnings.push(
          `Enrollment QC recipient lookup failed: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
      const qcRecipients = uniqueEnrollmentNotificationRecipients(
        [updated.caller_email, updated.responsible_enroll_email, ...adminEmails],
        [actorResult.actor.email]
      );
      for (const recipient of qcRecipients) {
        notifications.push({
          recipient_email: recipient,
          record_id: id,
          type: "qc_needed",
          actor_email: actorResult.actor.email,
          detail: toStage.label,
        });
      }
    } else if (toStage && KEY_STAGE_NOTIFICATIONS.has(toStage.label)) {
      for (const recipient of uniqueEnrollmentNotificationRecipients(
        [updated.caller_email, updated.responsible_enroll_email],
        [actorResult.actor.email]
      )) {
        notifications.push({
          recipient_email: recipient,
          record_id: id,
          type: "stage_changed",
          actor_email: actorResult.actor.email,
          detail: toStage.label,
        });
      }
    }
  }

  if (persistedChangedFields.some((field) => field === "caller_email" || field === "responsible_enroll_email")) {
    activityRows.push({
      record_id: id,
      actor_email: actorResult.actor.email,
      type: "people_changed",
      meta: {
        caller: updated.caller_email,
        responsible_enroll: updated.responsible_enroll_email,
      },
    });
    for (const recipient of uniqueEnrollmentNotificationRecipients(
      [updated.caller_email, updated.responsible_enroll_email],
      [actorResult.actor.email]
    )) {
      notifications.push({
        recipient_email: recipient,
        record_id: id,
        type: "assigned",
        actor_email: actorResult.actor.email,
        detail: "Enrollment responsibility changed",
      });
    }
  }

  if (qcChecked !== null) {
    activityRows.push({
      record_id: id,
      actor_email: actorResult.actor.email,
      type: qcChecked ? "qc_reviewed" : "qc_review_cleared",
      meta: null,
    });
    if (qcChecked) {
      for (const recipient of uniqueEnrollmentNotificationRecipients(
        [updated.caller_email, updated.responsible_enroll_email],
        [actorResult.actor.email]
      )) {
        notifications.push({
          recipient_email: recipient,
          record_id: id,
          type: "qc_reviewed",
          actor_email: actorResult.actor.email,
        });
      }
    }
  }

  const genericChangedFields = persistedChangedFields.filter(
    (field) =>
      field !== "stage_id" &&
      field !== "caller_email" &&
      field !== "responsible_enroll_email" &&
      field !== "qc_checked" &&
      field !== "qc_cleared"
  );
  if (genericChangedFields.length > 0) {
    activityRows.push({
      record_id: id,
      actor_email: actorResult.actor.email,
      type: "field_changed",
      meta: { fields: genericChangedFields },
    });
  }

  if (activityRows.length > 0) {
    const { error: activityError } = await supabase
      .from("enrollment_activity")
      .insert(activityRows);
    if (activityError) {
      mutationWarnings.push(`enrollment_activity: ${activityError.message}`);
    }
  }
  try {
    await insertEnrollmentNotifications(notifications);
  } catch (error) {
    mutationWarnings.push(
      error instanceof Error ? error.message : "Enrollment notification write failed."
    );
  }
  try {
    await broadcastEnrollmentChanged();
    await broadcastEnrollmentRoom(id);
  } catch (error) {
    mutationWarnings.push(
      `Enrollment broadcast failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  let record: EnrollmentRecordWithStats | null = null;
  try {
    record = await fetchEnrollmentRecordById(id);
  } catch (error) {
    mutationWarnings.push(
      `Enrollment canonical reload failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  if (mutationWarnings.length > 0) {
    console.error("Enrollment update committed with side-effect warnings", {
      recordId: id,
      warnings: mutationWarnings,
    });
  }
  return NextResponse.json({
    record: record ?? { ...updated, comment_count: 0, attachment_count: 0 },
    warnings: mutationWarnings,
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data: currentData, error: currentError } = await supabase
    .from("enrollment_records")
    .select("id,caller_email,responsible_enroll_email,created_by_email")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
  if (!currentData) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canArchiveEnrollmentRecord(actorResult.actor, currentData)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("enrollment_records")
    .update({
      archived_at: nowIso,
      updated_at: nowIso,
      updated_by_email: actorResult.actor.email,
    })
    .eq("id", id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error: activityError } = await supabase.from("enrollment_activity").insert({
    record_id: id,
    actor_email: actorResult.actor.email,
    type: "archived",
    meta: null,
  });
  if (activityError) {
    console.error("Failed to write enrollment archive activity", activityError);
  }
  await broadcastEnrollmentChanged();
  await broadcastEnrollmentRoom(id);
  return NextResponse.json({ ok: true });
}

function optionEntries(): [keyof typeof OPTION_FIELDS, EnrollmentOptionSetKey][] {
  return Object.entries(OPTION_FIELDS) as [
    keyof typeof OPTION_FIELDS,
    EnrollmentOptionSetKey,
  ][];
}

function isOptionInSet(
  optionById: Map<string, EnrollmentOption>,
  optionId: string,
  setKey: EnrollmentOptionSetKey
) {
  const option = optionById.get(optionId);
  return Boolean(option && option.set_key === setKey && !option.archived_at);
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanCustomValues(values: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!key.trim()) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      next[key] = value;
    }
  }
  return next;
}

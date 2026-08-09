import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  canCreateEnrollmentWithScope,
  loadEnrollmentActor,
} from "@/lib/enrollment/access";
import {
  fetchEnrollmentRecords,
  EnrollmentListTruncatedError,
  isMissingEnrollmentDescriptionColumn,
} from "@/lib/enrollment/queries";
import {
  assertEnrollmentOptionSet,
  fetchEnrollmentOptionData,
  firstStageOption,
} from "@/lib/enrollment/options";
import {
  insertEnrollmentNotifications,
  uniqueEnrollmentNotificationRecipients,
} from "@/lib/enrollment/notifications";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import {
  fetchAdminEmails,
  isAgentOwnerOrAssistant,
} from "@/lib/tasks/membership";
import {
  parseEnrollmentProgram,
  type EnrollmentRecordWithStats,
} from "@/lib/enrollment/types";
import { sanitizeEnrollmentPatchForProgram } from "@/lib/enrollment/program-fields";
import { parseEnrollmentDate } from "@/lib/enrollment/dates";
import {
  enrollmentOwnershipFieldLabel,
  validateEnrollmentOwnership,
} from "@/lib/enrollment/ownership";
import {
  findMissingRequiredFields,
  missingRequiredFieldsMessage,
} from "@/lib/table-config/required";
import { resolveEnrollmentScope } from "@/lib/enrollment/scope";

export const dynamic = "force-dynamic";

type CreateBody = Record<string, unknown>;

const STRING_FIELDS = [
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

export async function GET(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const program = parseEnrollmentProgram(
    new URL(request.url).searchParams.get("program")
  );
  if (!program) {
    return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  }
  try {
    const scope = await resolveEnrollmentScope(actorResult.actor);
    const records = await fetchEnrollmentRecords(program, scope);
    return NextResponse.json({ records });
  } catch (error) {
    if (error instanceof EnrollmentListTruncatedError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "ENROLLMENT_LIST_TRUNCATED",
          total: error.total,
          loaded: error.loaded,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load enrollment records." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const body = (await request.json().catch(() => null)) as CreateBody | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const program = parseEnrollmentProgram(body.program);
  if (!program) {
    return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  }
  const patch: Record<string, unknown> = { program };
  for (const field of STRING_FIELDS) {
    patch[field] = cleanText(body[field]);
  }

  const dueDate = parseEnrollmentDate(body.due_date);
  if (dueDate.error) {
    return NextResponse.json({ error: dueDate.error }, { status: 400 });
  }
  patch.due_date = dueDate.value;

  const { optionsBySet } = await fetchEnrollmentOptionData(program);
  const fallbackStage = firstStageOption(optionsBySet);
  for (const [field, setKey] of Object.entries(OPTION_FIELDS)) {
    const requested = cleanText(body[field]);
    if (field === "stage_id" && !requested) {
      patch.stage_id = fallbackStage?.id ?? null;
      continue;
    }
    try {
      const option = requested ? await assertEnrollmentOptionSet(requested, setKey, program) : null;
      patch[field] = requested
        ? option?.id ?? null
        : null;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid option." },
        { status: 400 }
      );
    }
  }

  try {
    const invalidOwner = await validateEnrollmentOwnership({
      agent_email: patch.agent_email as string | null,
      caller_email: patch.caller_email as string | null,
      responsible_enroll_email: patch.responsible_enroll_email as string | null,
    });
    if (invalidOwner) {
      return NextResponse.json(
        {
          error: `${enrollmentOwnershipFieldLabel(invalidOwner.field)} must be an active account${
            invalidOwner.field === "agent_email" ? " selected as a task agent" : ""
          }.`,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not validate enrollment ownership." },
      { status: 500 }
    );
  }

  const requestedAgentEmail = patch.agent_email as string | null;
  const hasRequestedAgentScope = actorResult.actor.isManager
    ? false
    : await isAgentOwnerOrAssistant(
        requestedAgentEmail,
        actorResult.actor.email
      );
  if (
    !canCreateEnrollmentWithScope(
      actorResult.actor,
      hasRequestedAgentScope
    )
  ) {
    return NextResponse.json(
      { error: "You cannot create enrollment records for this agent." },
      { status: 403 }
    );
  }

  // No more either/or (client_name OR fub_link) — each field's required-ness
  // is now independently controlled by table_column.required (Config →
  // Table Columns), read fresh from the DB inside findMissingRequiredFields.
  // That function keys fieldValues by table_column.key, which differs from
  // this table's own column names for most of these — translate here, at
  // the point where both names are already in scope, rather than via a
  // separate shared table.
  const missingRequired = await findMissingRequiredFields(program, {
    fieldValues: {
      client: patch.client_name,
      description: patch.description,
      fub: patch.fub_link,
      due: patch.due_date,
      stage: patch.stage_id,
      carrier: patch.carrier_id,
      platform: patch.platform_id,
      consent: patch.consent_id,
      payment: patch.payment_status_id,
      aca: patch.aca_status_id,
      pcp2025: patch.pcp_2025,
      pcp2026: patch.pcp_2026,
      agent: patch.agent_email,
      caller: patch.caller_email,
      responsible: patch.responsible_enroll_email,
    },
    checkCustom: false,
  });
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: missingRequiredFieldsMessage(missingRequired) },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const selectedStage =
    typeof patch.stage_id === "string"
      ? optionsBySet.stage.find((option) => option.id === patch.stage_id) ?? null
      : null;
  if (selectedStage?.is_terminal) {
    patch.closed_at = nowIso;
  }

  const sanitizedPatch = sanitizeEnrollmentPatchForProgram(program, patch);

  const supabase = getSupabaseAdmin();
  const insertBase = {
    created_by_email: actorResult.actor.email,
    updated_by_email: actorResult.actor.email,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const insertResult = await supabase
    .from("enrollment_records")
    .insert({
      ...sanitizedPatch,
      ...insertBase,
    })
    .select("*")
    .single();
  if (isMissingEnrollmentDescriptionColumn(insertResult.error)) {
    return NextResponse.json(
      {
        error: "Database migration missing: enrollment_records.description.",
        code: "SCHEMA_OUT_OF_DATE",
      },
      { status: 503 }
    );
  }
  const { data, error } = insertResult;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const record = { description: null, ...data } as EnrollmentRecordWithStats;
  // The canonical record is committed before audit/notification fan-out. Do
  // not return a retryable 5xx for a post-commit side-effect failure: callers
  // would retry and create duplicates. Keep the committed response truthful,
  // log warnings, and leave durable transaction/repair work explicit.
  const mutationWarnings: string[] = [];
  const activityRows: {
    record_id: string;
    actor_email: string;
    type: string;
    meta: Record<string, unknown> | null;
  }[] = [
    {
      record_id: record.id,
      actor_email: actorResult.actor.email,
      type: "created",
      meta: null,
    },
  ];
  if (selectedStage?.triggers_qc) {
    activityRows.push({
      record_id: record.id,
      actor_email: actorResult.actor.email,
      type: "qc_needed",
      meta: { stage: selectedStage.label },
    });
  }

  const auditResults = await Promise.allSettled([
    supabase.from("enrollment_activity").insert(activityRows).then(({ error: activityError }) => {
      if (activityError) throw new Error(`enrollment_activity: ${activityError.message}`);
    }),
    record.stage_id
      ? supabase
          .from("enrollment_stage_history")
          .insert({
            record_id: record.id,
            from_option_id: null,
            to_option_id: record.stage_id,
            changed_by_email: actorResult.actor.email,
            changed_at: nowIso,
          })
          .then(({ error: historyError }) => {
            if (historyError) throw new Error(`enrollment_stage_history: ${historyError.message}`);
          })
      : null,
  ]);
  for (const result of auditResults) {
    if (result.status === "rejected") {
      mutationWarnings.push(
        result.reason instanceof Error ? result.reason.message : "Enrollment audit write failed."
      );
    }
  }

  const recipients = uniqueEnrollmentNotificationRecipients(
    [record.caller_email, record.responsible_enroll_email],
    [actorResult.actor.email]
  );
  const notificationPromises: Promise<void>[] = [
    insertEnrollmentNotifications(
      recipients.map((recipient) => ({
        recipient_email: recipient,
        record_id: record.id,
        type: "assigned",
        actor_email: actorResult.actor.email,
        detail: "New enrollment record",
      }))
    ),
  ];

  if (selectedStage?.triggers_qc) {
    notificationPromises.push(
      (async () => {
        let adminEmails: string[] = [];
        try {
          adminEmails = await fetchAdminEmails();
        } catch (error) {
          throw new Error(
            `Enrollment QC recipient lookup failed: ${error instanceof Error ? error.message : "unknown error"}`
          );
        }
        const qcRecipients = uniqueEnrollmentNotificationRecipients(
          [record.caller_email, record.responsible_enroll_email, ...adminEmails],
          [actorResult.actor.email]
        );
        await insertEnrollmentNotifications(
          qcRecipients.map((recipient) => ({
            recipient_email: recipient,
            record_id: record.id,
            type: "qc_needed",
            actor_email: actorResult.actor.email,
            detail: selectedStage.label,
          }))
        );
      })()
    );
  }

  const notificationResults = await Promise.allSettled(notificationPromises);
  for (const result of notificationResults) {
    if (result.status === "rejected") {
      mutationWarnings.push(
        result.reason instanceof Error
          ? result.reason.message
          : "Enrollment notification write failed."
      );
    }
  }

  try {
    await broadcastEnrollmentChanged(program);
  } catch (error) {
    mutationWarnings.push(
      `Enrollment broadcast failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  if (mutationWarnings.length > 0) {
    console.error("Enrollment create committed with side-effect warnings", {
      recordId: record.id,
      warnings: mutationWarnings,
    });
  }
  return NextResponse.json({
    record: { ...record, comment_count: 0, attachment_count: 0 },
    warnings: mutationWarnings,
  });
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

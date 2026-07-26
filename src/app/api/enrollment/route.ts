import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { fetchEnrollmentRecords } from "@/lib/enrollment/queries";
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
import { fetchAdminEmails } from "@/lib/tasks/membership";
import {
  toEnrollmentProgram,
  type EnrollmentRecordWithStats,
} from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

type CreateBody = Record<string, unknown>;

const STRING_FIELDS = [
  "client_name",
  "fub_link",
  "pcp_2025",
  "pcp_2026",
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

  const program = toEnrollmentProgram(
    new URL(request.url).searchParams.get("program")
  );
  const records = await fetchEnrollmentRecords(program);
  return NextResponse.json({ records });
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

  const program = toEnrollmentProgram(body.program);
  const patch: Record<string, unknown> = { program };
  for (const field of STRING_FIELDS) {
    patch[field] = cleanText(body[field]);
  }

  const dueDate = cleanDate(body.due_date);
  patch.due_date = dueDate;

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

  if (!patch.client_name && !patch.fub_link) {
    return NextResponse.json(
      { error: "Client name or FUB link is required." },
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

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("enrollment_records")
    .insert({
      ...patch,
      created_by_email: actorResult.actor.email,
      updated_by_email: actorResult.actor.email,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const record = data as EnrollmentRecordWithStats;
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

  await Promise.all([
    supabase.from("enrollment_activity").insert(activityRows),
    record.stage_id
      ? supabase.from("enrollment_stage_history").insert({
          record_id: record.id,
          from_option_id: null,
          to_option_id: record.stage_id,
          changed_by_email: actorResult.actor.email,
          changed_at: nowIso,
        })
      : null,
  ]);

  const recipients = uniqueEnrollmentNotificationRecipients(
    [record.caller_email, record.responsible_enroll_email],
    [actorResult.actor.email]
  );
  await insertEnrollmentNotifications(
    recipients.map((recipient) => ({
      recipient_email: recipient,
      record_id: record.id,
      type: "assigned",
      actor_email: actorResult.actor.email,
      detail: "New enrollment record",
    }))
  );

  if (selectedStage?.triggers_qc) {
    const qcRecipients = uniqueEnrollmentNotificationRecipients(
      [record.caller_email, record.responsible_enroll_email, ...(await fetchAdminEmails())],
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
  }

  await broadcastEnrollmentChanged();
  return NextResponse.json({
    record: { ...record, comment_count: 0, attachment_count: 0 },
  });
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

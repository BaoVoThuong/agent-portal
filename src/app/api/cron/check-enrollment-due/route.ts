import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  insertEnrollmentNotifications,
  uniqueEnrollmentNotificationRecipients,
} from "@/lib/enrollment/notifications";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import { fetchAdminEmails } from "@/lib/tasks/membership";
import { resolveReminderSettings } from "@/lib/tasks/reminder-settings";
import { checkCronAuthorization } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

type DueRecord = {
  id: string;
  client_name: string | null;
  due_date: string | null;
  caller_email: string | null;
  responsible_enroll_email: string | null;
  due_soon_notified_at: string | null;
  overdue_notified_at: string | null;
  overdue_reminded_at: string | null;
  qc_stale_notified_at: string | null;
  qc_checked_at: string | null;
  closed_at: string | null;
  stage_id: string | null;
};

export async function GET(request: Request) {
  const authResult = checkCronAuthorization(request);
  if (authResult === "misconfigured") {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (authResult === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();
  const today = toDateOnly(now);
  const tomorrow = toDateOnly(new Date(now.getTime() + 86_400_000));
  const reminderCutoff = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const { data: settingsRow, error: settingsError } = await supabase
    .from("task_reminder_settings")
    .select("*")
    .maybeSingle();
  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 500 });
  }
  const settings = resolveReminderSettings(settingsRow);
  const qcCutoff = new Date(now.getTime() - settings.qcHours * 3600_000).toISOString();

  const { data, error } = await supabase
    .from("enrollment_records")
    .select(
      "id,client_name,due_date,stage_id,caller_email,responsible_enroll_email,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,qc_checked_at,closed_at"
    )
    .is("archived_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const records = (data ?? []) as DueRecord[];
  const dueSoon = records.filter(
    (record) =>
      !record.closed_at &&
      record.due_date &&
      record.due_date >= today &&
      record.due_date <= tomorrow &&
      !record.due_soon_notified_at
  );
  const newlyOverdue = records.filter(
    (record) =>
      !record.closed_at &&
      record.due_date &&
      record.due_date < today &&
      !record.overdue_notified_at
  );
  const overdueReminder = records.filter(
    (record) =>
      !record.closed_at &&
      record.due_date &&
      record.due_date < today &&
      Boolean(record.overdue_notified_at) &&
      (!record.overdue_reminded_at || record.overdue_reminded_at <= reminderCutoff)
  );
  const { data: qcStageRows, error: qcStageError } = await supabase
    .from("enrollment_options")
    .select("id")
    .eq("triggers_qc", true)
    .is("archived_at", null);
  if (qcStageError) {
    return NextResponse.json({ error: qcStageError.message }, { status: 500 });
  }
  const qcStageIds = new Set(
    ((qcStageRows ?? []) as { id: string }[]).map((stage) => stage.id)
  );
  const qcStale = records.filter(
    (record) =>
      record.stage_id &&
      qcStageIds.has(record.stage_id) &&
      record.closed_at &&
      record.closed_at <= qcCutoff &&
      !record.qc_checked_at &&
      !record.qc_stale_notified_at
  );

  await Promise.all([
    ...dueSoon.map(async (record) => {
      await supabase
        .from("enrollment_records")
        .update({
          due_soon_notified_at: nowIso,
          updated_at: nowIso,
          updated_by_email: "system",
        })
        .eq("id", record.id)
        .is("due_soon_notified_at", null);
      await supabase.from("enrollment_activity").insert({
        record_id: record.id,
        actor_email: "system",
        type: "due_soon",
        meta: { due_date: record.due_date },
        created_at: nowIso,
      });
      await notifyRecordOwners(record, "due_soon", "Enrollment due date is near");
    }),
    ...newlyOverdue.map(async (record) => {
      await supabase
        .from("enrollment_records")
        .update({
          overdue_notified_at: nowIso,
          overdue_reminded_at: nowIso,
          updated_at: nowIso,
          updated_by_email: "system",
        })
        .eq("id", record.id)
        .is("overdue_notified_at", null);
      await supabase.from("enrollment_activity").insert({
        record_id: record.id,
        actor_email: "system",
        type: "went_overdue",
        meta: { due_date: record.due_date, flagged_at: nowIso },
        created_at: nowIso,
      });
      await notifyRecordOwners(record, "overdue", "Enrollment breached due-date SLA");
    }),
    ...overdueReminder.map(async (record) => {
      await supabase
        .from("enrollment_records")
        .update({
          overdue_reminded_at: nowIso,
          updated_at: nowIso,
          updated_by_email: "system",
        })
        .eq("id", record.id);
      await notifyRecordOwners(record, "overdue_reminder", "Enrollment is still overdue");
    }),
    ...qcStale.map(async (record) => {
      await supabase
        .from("enrollment_records")
        .update({
          qc_stale_notified_at: nowIso,
          updated_at: nowIso,
          updated_by_email: "system",
        })
        .eq("id", record.id)
        .is("qc_stale_notified_at", null);
      const recipients = uniqueEnrollmentNotificationRecipients([
        record.caller_email,
        record.responsible_enroll_email,
        ...(await fetchAdminEmails()),
      ]);
      await insertEnrollmentNotifications(
        recipients.map((recipient) => ({
          recipient_email: recipient,
          record_id: record.id,
          type: "qc_stale",
          actor_email: "system",
          detail: "Enrollment DONE record still needs QC",
        }))
      );
    }),
  ]);

  if (
    dueSoon.length > 0 ||
    newlyOverdue.length > 0 ||
    overdueReminder.length > 0 ||
    qcStale.length > 0
  ) {
    await broadcastEnrollmentChanged();
  }

  return NextResponse.json({
    ok: true,
    dueSoon: dueSoon.length,
    newlyOverdue: newlyOverdue.length,
    overdueReminder: overdueReminder.length,
    qcStale: qcStale.length,
  });
}

async function notifyRecordOwners(
  record: DueRecord,
  type: "due_soon" | "overdue" | "overdue_reminder",
  detail: string
) {
  const recipients = uniqueEnrollmentNotificationRecipients([
    record.caller_email,
    record.responsible_enroll_email,
  ]);
  await insertEnrollmentNotifications(
    recipients.map((recipient) => ({
      recipient_email: recipient,
      record_id: record.id,
      type,
      actor_email: "system",
      detail,
    }))
  );
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

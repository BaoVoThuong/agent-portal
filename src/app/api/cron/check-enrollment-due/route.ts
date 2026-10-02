import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  enrollmentRecordOwnerEmails,
  insertEnrollmentNotifications,
  uniqueEnrollmentNotificationRecipients,
  type EnrollmentNotificationInsertInput,
} from "@/lib/enrollment/notifications";
import {
  fetchEnrollmentManagerEmails,
  filterEnrollmentNotificationRows,
} from "@/lib/enrollment/recipients";
import {
  businessDate,
  classifyDueRecord,
  dueRecipients,
  type DueAction,
  type DueRecordSchedule,
} from "@/lib/enrollment/due-schedule";
import { resolveReminderSettings } from "@/lib/tasks/reminder-settings";
import { checkCronAuthorization } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DueRecord = DueRecordSchedule & {
  id: string;
  client_name: string | null;
  qc_stale_notified_at: string | null;
  qc_checked_at: string | null;
  stage_id: string | null;
};

const PAGE_SIZE = 1000;
const BATCH_SIZE = 10;
const DUE_SELECT =
  "id,client_name,due_date,stage_id,caller_email,responsible_enroll_email,agent_email,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,qc_checked_at,closed_at";

async function fetchEnrollmentRows(closed: boolean): Promise<DueRecord[]> {
  const rows: DueRecord[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = getSupabaseAdmin()
      .from("enrollment_records")
      .select(DUE_SELECT)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    query = closed ? query.is("archived_at", null).not("closed_at", "is", null) : query.is("archived_at", null).is("closed_at", null);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as DueRecord[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function releaseMarker(
  id: string,
  column: string,
  claimedAt: string,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("enrollment_records")
    .update({ [column]: null })
    .eq("id", id)
    .eq(column, claimedAt);
  if (error) console.error("Failed to release enrollment cron marker", { id, column });
}

async function claimMarker(
  record: DueRecord,
  column: string,
  previous: string | null,
  nowIso: string,
): Promise<boolean> {
  const query = getSupabaseAdmin()
    .from("enrollment_records")
    .update({ [column]: nowIso })
    .eq("id", record.id);
  const filteredQuery = previous === null ? query.is(column, null) : query.eq(column, previous);
  const { data, error } = await filteredQuery.select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function notifyDueRecord(
  record: DueRecord,
  action: DueAction,
  managerEmails: readonly string[],
  nowIso: string,
  scopedRows: EnrollmentNotificationInsertInput[],
): Promise<boolean> {
  const recipients = dueRecipients(action, record, managerEmails);
  if (recipients.length === 0) return false;
  if (scopedRows.length === 0) return false;
  const marker = action === "due_soon"
    ? "due_soon_notified_at"
    : action === "overdue"
      ? "overdue_notified_at"
      : "overdue_reminded_at";
  if (!(await claimMarker(record, marker, record[marker], nowIso))) return false;
  try {
    await insertEnrollmentNotifications(scopedRows, { alreadyScoped: true });
    if (action !== "overdue_reminder") {
      const { error } = await getSupabaseAdmin().from("enrollment_activity").insert({
        record_id: record.id,
        actor_email: "system",
        type: action === "due_soon" ? "due_soon" : "went_overdue",
        meta: { due_date: record.due_date, flagged_at: nowIso },
        created_at: nowIso,
      });
      if (error) console.error("Enrollment due activity write failed", { id: record.id });
    }
    return true;
  } catch (error) {
    await releaseMarker(record.id, marker, nowIso);
    throw error;
  }
}

async function notifyQcStale(
  record: DueRecord,
  managerEmails: readonly string[],
  nowIso: string,
  scopedRows: EnrollmentNotificationInsertInput[],
): Promise<boolean> {
  const recipients = uniqueEnrollmentNotificationRecipients([
    ...enrollmentRecordOwnerEmails(record),
    ...managerEmails,
  ]);
  if (recipients.length === 0) return false;
  if (scopedRows.length === 0) return false;
  if (!(await claimMarker(record, "qc_stale_notified_at", record.qc_stale_notified_at, nowIso))) {
    return false;
  }
  try {
    await insertEnrollmentNotifications(scopedRows, { alreadyScoped: true });
    return true;
  } catch (error) {
    await releaseMarker(record.id, "qc_stale_notified_at", nowIso);
    throw error;
  }
}

async function inBatches<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
    await Promise.all(items.slice(offset, offset + BATCH_SIZE).map(fn));
  }
}

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
  const today = businessDate(now);
  const { data: settingsRow, error: settingsError } = await supabase
    .from("task_reminder_settings")
    .select("*")
    .maybeSingle();
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 });
  const settings = resolveReminderSettings(settingsRow);
  const qcCutoff = new Date(now.getTime() - settings.qcHours * 3600_000).toISOString();

  let managerEmails: string[];
  try {
    managerEmails = await fetchEnrollmentManagerEmails();
  } catch (error) {
    return NextResponse.json(
      { error: `Could not resolve Enrollment manager recipients: ${error instanceof Error ? error.message : "unknown error"}` },
      { status: 500 },
    );
  }

  let records: DueRecord[];
  try {
    records = await fetchEnrollmentRows(false);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load Enrollment records" }, { status: 500 });
  }

  const { data: qcStageRows, error: qcStageError } = await supabase
    .from("enrollment_options")
    .select("id")
    .eq("triggers_qc", true)
    .is("archived_at", null);
  if (qcStageError) return NextResponse.json({ error: qcStageError.message }, { status: 500 });
  const qcStageIds = new Set(((qcStageRows ?? []) as { id: string }[]).map((stage) => stage.id));

  let qcRecords: DueRecord[];
  try {
    qcRecords = await fetchEnrollmentRows(true);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load QC records" }, { status: 500 });
  }
  const dueActions = records
    .map((record) => ({ record, action: classifyDueRecord(record, today) }))
    .filter((item): item is { record: DueRecord; action: DueAction } => Boolean(item.action));
  const qcStale = qcRecords.filter(
    (record) =>
      record.stage_id && qcStageIds.has(record.stage_id) && record.closed_at &&
      record.closed_at <= qcCutoff && !record.qc_checked_at && !record.qc_stale_notified_at,
  );

  const dueCandidates = dueActions.flatMap(({ record, action }) =>
    dueRecipients(action, record, managerEmails).map((recipient) => ({
      recipient_email: recipient,
      record_id: record.id,
      type: action,
      actor_email: "system",
      detail:
        action === "due_soon"
          ? "Enrollment due date is near"
          : action === "overdue"
            ? "Enrollment breached due-date SLA"
            : "Enrollment is still overdue",
    })),
  );
  const scopedDue = await filterEnrollmentNotificationRows(dueCandidates);
  const dueRowsByKey = new Map<string, EnrollmentNotificationInsertInput[]>();
  for (const row of scopedDue.kept) {
    const key = `${row.record_id}\0${row.type}`;
    dueRowsByKey.set(key, [...(dueRowsByKey.get(key) ?? []), row]);
  }
  const qcCandidates = qcStale.flatMap((record) =>
    uniqueEnrollmentNotificationRecipients([
      ...enrollmentRecordOwnerEmails(record),
      ...managerEmails,
    ]).map((recipient) => ({
      recipient_email: recipient,
      record_id: record.id,
      type: "qc_stale" as const,
      actor_email: "system",
      detail: "Enrollment DONE record still needs QC",
    })),
  );
  const scopedQc = await filterEnrollmentNotificationRows(qcCandidates);
  const qcRowsById = new Map<string, EnrollmentNotificationInsertInput[]>();
  for (const row of scopedQc.kept) {
    qcRowsById.set(row.record_id, [...(qcRowsById.get(row.record_id) ?? []), row]);
  }
  const skippedNoRecipient =
    [...dueActions].filter(({ record, action }) => !dueRowsByKey.has(`${record.id}\0${action}`)).length +
    qcStale.filter((record) => !qcRowsById.has(record.id)).length;

  let sentDueSoon = 0;
  let sentOverdue = 0;
  let sentOverdueReminder = 0;
  let sentQcStale = 0;
  let failed = 0;
  await inBatches(dueActions, async ({ record, action }) => {
    let sent = false;
    try {
      sent = await notifyDueRecord(
        record,
        action,
        managerEmails,
        nowIso,
        dueRowsByKey.get(`${record.id}\0${action}`) ?? [],
      );
    } catch (error) {
      failed += 1;
      console.error("Enrollment due notification failed", { id: record.id, action, error });
    }
    if (!sent) return;
    if (action === "due_soon") sentDueSoon += 1;
    if (action === "overdue") sentOverdue += 1;
    if (action === "overdue_reminder") sentOverdueReminder += 1;
  });
  await inBatches(qcStale, async (record) => {
    try {
      if (await notifyQcStale(record, managerEmails, nowIso, qcRowsById.get(record.id) ?? [])) sentQcStale += 1;
    } catch (error) {
      failed += 1;
      console.error("Enrollment QC stale notification failed", { id: record.id, error });
    }
  });
  return NextResponse.json({
    ok: true,
    today,
    dueSoon: sentDueSoon,
    newlyOverdue: sentOverdue,
    overdueReminder: sentOverdueReminder,
    qcStale: sentQcStale,
    skippedNoRecipient,
    failed,
  });
}

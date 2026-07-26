import { getSupabaseAdmin } from "@/lib/supabase";
import { broadcastNotif } from "@/lib/tasks/realtime";
import type { EnrollmentNotificationType } from "./types";

export type EnrollmentNotificationInsertInput = {
  recipient_email: string;
  record_id: string;
  type: EnrollmentNotificationType;
  actor_email: string;
  comment_id?: string | null;
  detail?: string | null;
};

export async function insertEnrollmentNotifications(
  rows: EnrollmentNotificationInsertInput[]
): Promise<void> {
  const uniqueRows = uniqueEnrollmentNotificationRows(rows);
  if (uniqueRows.length === 0) return;

  const { error } = await getSupabaseAdmin().from("enrollment_notifications").insert(
    uniqueRows.map((row) => ({
      recipient_email: row.recipient_email,
      record_id: row.record_id,
      type: row.type,
      actor_email: row.actor_email,
      comment_id: row.comment_id ?? null,
      detail: row.detail ?? null,
    }))
  );
  if (error) throw new Error(error.message);

  await broadcastNotif(uniqueRows.map((row) => row.recipient_email));
}

export function uniqueEnrollmentNotificationRecipients(
  emails: (string | null | undefined)[],
  excluded: (string | null | undefined)[] = []
): string[] {
  const excludedSet = new Set(
    excluded.map((email) => normalizeEmail(email)).filter(Boolean)
  );
  return [
    ...new Set(
      emails
        .map((email) => normalizeEmail(email))
        .filter((email): email is string => Boolean(email && !excludedSet.has(email)))
    ),
  ];
}

export function uniqueEnrollmentNotificationRows(
  rows: EnrollmentNotificationInsertInput[]
): EnrollmentNotificationInsertInput[] {
  const seen = new Set<string>();
  return rows
    .map((row) => ({ ...row, recipient_email: normalizeEmail(row.recipient_email) ?? "" }))
    .filter((row) => {
      if (!row.recipient_email) return false;
      const key = [
        row.recipient_email,
        row.record_id,
        row.type,
        row.actor_email,
        row.comment_id ?? "",
        row.detail ?? "",
      ].join("\0");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

import { getSupabaseAdmin } from "@/lib/supabase";
import { runAfterResponse } from "@/lib/after-response";
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
  rows: EnrollmentNotificationInsertInput[],
  options: {
    alreadyScoped?: boolean;
    /**
     * Phát realtime + push sau khi response đã trả. Lọc người nhận theo quyền
     * xem và ghi dòng vẫn chạy trong request — xem lib/tasks/notifications.ts.
     */
    deliverAfterResponse?: boolean;
  } = {},
): Promise<void> {
  const recordIds = [...new Set(rows.map((row) => row.record_id))];
  try {
    const candidateRows = uniqueEnrollmentNotificationRows(rows);
    const { kept: scopedRows, droppedCount } = options.alreadyScoped
      ? { kept: candidateRows, droppedCount: 0 }
      : await (async () => {
          const { filterEnrollmentNotificationRows } = await import("./recipients");
          return filterEnrollmentNotificationRows(candidateRows);
        })();
    if (droppedCount > 0) {
      console.warn("Enrollment notifications dropped by current access scope", {
        droppedCount,
      });
    }
    const uniqueRows = uniqueEnrollmentNotificationRows(scopedRows);
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

    if (
      options.deliverAfterResponse &&
      (await runAfterResponse(() => deliverEnrollmentNotifications(uniqueRows)))
    ) {
      return;
    }

    await broadcastNotif(uniqueRows.map((row) => row.recipient_email));

    // Đẩy ra ngoài trình duyệt — xem ghi chú ở lib/tasks/notifications.ts.
    await schedulePush(async () => {
      const { pushForEnrollmentNotifications } = await import(
        "@/lib/notifications/push-dispatch"
      );
      await pushForEnrollmentNotifications(uniqueRows);
    });
  } catch (error) {
    console.error("enrollment.notification.failed", {
      recordIds,
      error: error instanceof Error ? error.message : "unknown error",
    });
    throw error;
  }
}

/**
 * Phần "phát đi" khi chạy trong `after()`: realtime rồi push, gọi thẳng. Không
 * ném lỗi — response đã trả, chỉ còn ghi log.
 */
async function deliverEnrollmentNotifications(
  rows: EnrollmentNotificationInsertInput[],
): Promise<void> {
  const recordIds = [...new Set(rows.map((row) => row.record_id))];
  try {
    const delivered = await broadcastNotif(rows.map((row) => row.recipient_email));
    if (!delivered) {
      console.error("enrollment.notification.delivery_failed", { recordIds, stage: "broadcast" });
    }
  } catch (error) {
    // Push is independent from Realtime. Keep attempting it even if Realtime
    // cannot initialise or its transport unexpectedly rejects.
    console.error("enrollment.notification.delivery_failed", {
      recordIds,
      stage: "broadcast",
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
  try {
    const { pushForEnrollmentNotifications } = await import(
      "@/lib/notifications/push-dispatch"
    );
    await pushForEnrollmentNotifications(rows);
  } catch (error) {
    console.error("enrollment.notification.delivery_failed", {
      recordIds,
      stage: "push",
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}

/** The people responsible for an Enrollment record. */
export function enrollmentRecordOwnerEmails(record: {
  caller_email: string | null;
  responsible_enroll_email: string | null;
  agent_email: string | null;
}): (string | null)[] {
  return [record.caller_email, record.responsible_enroll_email, record.agent_email];
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

/**
 * Đẩy thông báo ra ngoài trình duyệt, sau khi response đã trả.
 *
 * `after()` của Next chạy tiếp khi request đã kết thúc, và trên Vercel nó giữ
 * function sống đủ lâu để hoàn tất. Cố ý KHÔNG thả promise trôi: serverless giết
 * tiến trình ngay sau response, nên promise thả trôi bị cắt giữa chừng và người
 * nhận mất thông báo một cách ngẫu nhiên.
 *
 * Nạp động vì hai lý do: `push-dispatch` là `server-only` (không được kéo vào
 * test đang import module này), và ngoài request scope — script, cron chạy tay —
 * thì `after()` ném lỗi, lúc đó bỏ qua là đúng.
 */
async function schedulePush(run: () => Promise<void>): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    // Ngoài request scope: bỏ qua push, thông báo trong web vẫn đã ghi xong.
  }
}

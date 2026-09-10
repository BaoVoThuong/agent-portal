import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { taskDisplayKey } from "@/lib/tasks/sorting";
import { enrollmentDisplayKey } from "@/lib/enrollment/helpers";
import type { EnrollmentProgram } from "@/lib/enrollment/types";
import { buildPushPayload, sendPushToEmails } from "./push-server";
import type { NotificationCopySource, NotificationCopyType } from "./copy";

/**
 * Biến các dòng thông báo vừa ghi thành thông báo đẩy ra ngoài trình duyệt.
 *
 * Xem docs/2026-09-10-web-push-notifications.md.
 *
 * File này nằm riêng khỏi `lib/tasks/notifications.ts` vì nó `server-only`; gộp
 * chung sẽ kéo ràng buộc đó vào mọi test đang import module thông báo.
 *
 * Mọi hàm ở đây đều NUỐT lỗi: chúng chạy sau khi thông báo đã ghi xong và sau
 * khi response đã trả, nên một trục trặc ở đây không được phép nổi lên thành
 * lỗi của thao tác mà người dùng vừa làm.
 */

export type DispatchRow = {
  recipient_email: string;
  actor_email: string;
  type: string;
  entity_id: string;
};

/** Tên hiển thị của người gây ra thông báo; không tra được thì dùng chính email. */
async function labelsForActors(emails: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()))].filter(
    Boolean
  );
  const labels = new Map<string, string>();
  if (unique.length === 0) return labels;

  try {
    const { data } = await getSupabaseAdmin()
      .from("portal_account")
      .select("email,name")
      .in("email", unique);
    for (const row of (data ?? []) as { email: string; name: string | null }[]) {
      const name = row.name?.trim();
      if (name) labels.set(row.email.trim().toLowerCase(), name);
    }
  } catch {
    // Không tra được tên thì rơi về email — vẫn đọc hiểu được.
  }
  return labels;
}

function actorLabel(email: string, labels: Map<string, string>): string {
  const normalized = email.trim().toLowerCase();
  return labels.get(normalized) ?? normalized;
}

export type PushGroup = {
  source: NotificationCopySource;
  actorEmail: string;
  emails: string[];
};

/**
 * Gom những dòng cho ra CÙNG một nội dung push, rồi gửi một lượt cho tất cả
 * người nhận.
 *
 * Bản đầu gọi `sendPushToEmails()` cho từng dòng, mà mỗi lượt là hai truy vấn
 * (kiểm tuỳ chọn + lấy đăng ký). Một bình luận nhắc tên 10 người thành 20 truy
 * vấn cho đúng một nội dung giống hệt nhau.
 *
 * Khoá gom gồm CẢ `actor_email`: hai người cùng bình luận vào một task trong
 * cùng một lượt ghi là hai thông báo khác nhau ("Ann commented" / "Khang
 * commented"). Gom theo mỗi bản ghi thì một nửa người nhận sẽ thấy sai tên.
 */
export function groupPushRows(
  rows: readonly DispatchRow[],
  entityType: "task" | "enrollment"
): PushGroup[] {
  const groups = new Map<string, PushGroup>();
  for (const row of rows) {
    const key = `${row.type}|${row.entity_id}|${row.actor_email}`;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.emails.includes(row.recipient_email)) {
        existing.emails.push(row.recipient_email);
      }
      continue;
    }
    groups.set(key, {
      source: {
        type: row.type as NotificationCopyType,
        entity_type: entityType,
        entity_id: row.entity_id,
        task_id: row.entity_id,
      },
      actorEmail: row.actor_email,
      emails: [row.recipient_email],
    });
  }
  return [...groups.values()];
}

async function dispatch(
  rows: DispatchRow[],
  entityType: "task" | "enrollment",
  titles: Map<string, string>
): Promise<void> {
  const labels = await labelsForActors(rows.map((row) => row.actor_email));

  await Promise.allSettled(
    groupPushRows(rows, entityType).map((group) =>
      sendPushToEmails(
        group.emails,
        buildPushPayload(group.source, {
          actorLabel: actorLabel(group.actorEmail, labels),
          entityTitle: titles.get(group.source.entity_id ?? "") ?? null,
        })
      )
    )
  );
}

/**
 * Tiêu đề thông báo cho task: "CS-12 · Gia hạn cho chị Lan".
 *
 * Người nhận cần biết NGAY là việc nào — một thông báo chỉ ghi "Ann commented on
 * a task" buộc họ phải mở ra mới biết có gấp không.
 */
export async function pushForTaskNotifications(
  rows: readonly {
    recipient_email: string;
    task_id: string;
    type: string;
    actor_email: string;
  }[]
): Promise<void> {
  try {
    if (rows.length === 0) return;
    const ids = [...new Set(rows.map((row) => row.task_id))];
    const titles = new Map<string, string>();

    try {
      const { data } = await getSupabaseAdmin()
        .from("tasks")
        .select("id,title,display_number")
        .in("id", ids);
      for (const row of (data ?? []) as {
        id: string;
        title: string | null;
        display_number: number | null;
      }[]) {
        const key = taskDisplayKey(row.display_number);
        const title = row.title?.trim();
        titles.set(row.id, title ? `${key} · ${title}` : key);
      }
    } catch {
      // Thiếu tiêu đề thì push vẫn gửi, chỉ là tiêu đề chung chung.
    }

    await dispatch(
      rows.map((row) => ({ ...row, entity_id: row.task_id })),
      "task",
      titles
    );
  } catch {
    // không làm gì
  }
}

export async function pushForEnrollmentNotifications(
  rows: readonly {
    recipient_email: string;
    record_id: string;
    type: string;
    actor_email: string;
  }[]
): Promise<void> {
  try {
    if (rows.length === 0) return;
    const ids = [...new Set(rows.map((row) => row.record_id))];
    const titles = new Map<string, string>();

    try {
      const { data } = await getSupabaseAdmin()
        .from("enrollment_records")
        .select("id,client_name,display_number,program")
        .in("id", ids);
      for (const row of (data ?? []) as {
        id: string;
        client_name: string | null;
        display_number: number | null;
        program: EnrollmentProgram;
      }[]) {
        const key = enrollmentDisplayKey(row.display_number, row.program);
        const name = row.client_name?.trim();
        titles.set(row.id, name ? `${key} · ${name}` : key);
      }
    } catch {
      // như trên
    }

    await dispatch(
      rows.map((row) => ({ ...row, entity_id: row.record_id })),
      "enrollment",
      titles
    );
  } catch {
    // không làm gì
  }
}

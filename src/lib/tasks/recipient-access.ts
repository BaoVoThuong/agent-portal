import { loadViewers, viewerSeesTask } from "@/lib/notifications/audience";

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Chỉ giữ người nhận XEM ĐƯỢC task vừa tạo, theo đúng `canViewTask`.
 *
 * Dùng cho `task_created` trước khi chọn loại thông báo ưu tiên. Task mới chưa có
 * participant. Tính theo LÔ (lib/notifications/audience.ts) — trước đây mỗi
 * người nhận tốn vài truy vấn riêng (review A P2-02). `insertNotifications` còn
 * lọc lại lần cuối trên dữ liệu trong DB.
 */
export async function filterTaskRecipientsWithAccess(
  task: { agent_email: string | null; reporter_email: string | null },
  assigneeEmails: readonly string[],
  emails: readonly string[]
): Promise<string[]> {
  const unique = [...new Set(emails.map(normalize).filter(Boolean))];
  if (unique.length === 0) return [];
  const viewers = await loadViewers(unique);
  const assignees = new Set(assigneeEmails.map(normalize));
  return unique.filter((email) => {
    const viewer = viewers.get(email);
    return Boolean(
      viewer &&
        viewerSeesTask(
          email,
          viewer,
          { agent_email: task.agent_email, assignee_email: null, reporter_email: task.reporter_email },
          { assignees, participants: new Set() }
        )
    );
  });
}

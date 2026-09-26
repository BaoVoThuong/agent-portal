import { grantsForAccess } from "@/lib/authz/principal";
import { getUserAccessByEmails } from "@/lib/rbac/access";
import { canViewTask, taskActorFromGrants } from "./access";
import { isAgentOwnerOrAssistant, resolveTaskQueueScope } from "./membership";

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Chỉ giữ người nhận XEM ĐƯỢC task, theo đúng `canViewTask`.
 *
 * Dùng cho `task_created`: danh sách ứng viên là mọi người giữ `task.manage`
 * (`fetchTaskManagerEmails`), trong khi xem toàn bộ task còn cần vai trò
 * task-admin. Không lọc thì một agent được cấp `task.manage` qua role tuỳ chỉnh
 * sẽ nhận tiêu đề task ngoài phạm vi của mình (S27).
 *
 * Task mới chưa có participant, nên không xét `isParticipant`.
 */
export async function filterTaskRecipientsWithAccess(
  task: { agent_email: string | null; reporter_email: string | null },
  assigneeEmails: readonly string[],
  emails: readonly string[]
): Promise<string[]> {
  const unique = [...new Set(emails.map(normalize).filter(Boolean))];
  if (unique.length === 0) return [];

  const accessByEmail = await getUserAccessByEmails(unique);
  const assignees = new Set(assigneeEmails.map(normalize));
  const reporter = normalize(task.reporter_email);

  const decisions = await Promise.all(
    unique.map(async (email) => {
      const access = accessByEmail.get(email);
      if (!access || !access.isActive) return false;
      const actor = taskActorFromGrants(email, await grantsForAccess(access));
      if (actor.isManager) return true;
      if (!actor.isWorker) return false;
      const [isAgentOwner, scope] = await Promise.all([
        isAgentOwnerOrAssistant(task.agent_email, email),
        resolveTaskQueueScope(actor),
      ]);
      return canViewTask(actor, { assignee_email: null }, {
        isAssignee: assignees.has(email),
        isReporter: reporter === email,
        isAgentOwner,
        seesAllTasks: scope.seesAllTasks,
      });
    })
  );
  return unique.filter((_, index) => decisions[index]);
}

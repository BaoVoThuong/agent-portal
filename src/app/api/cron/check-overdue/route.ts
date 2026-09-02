import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { currentStintDueAt, effectiveSlaMinutes, isTaskOverdue } from "@/lib/tasks/sla";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";
import { fetchTaskAssigneeEmails } from "@/lib/tasks/assignees";
import {
  fetchAdminEmails,
  fetchAgentOwnerAndAssistantEmails,
} from "@/lib/tasks/membership";
import {
  insertNotifications,
  uniqueNotificationRecipients,
  uniqueNotificationRows,
  type NotificationInsertInput,
} from "@/lib/tasks/notifications";
import { resolveReminderSettings } from "@/lib/tasks/reminder-settings";
import { intervalDue, isDueSoon, isStale } from "@/lib/tasks/reminders";
import type { TaskRow, TaskSlaRule } from "@/lib/tasks/types";
import { checkCronAuthorization } from "@/lib/cron-auth";
import { isTaskRowDueDateOverdue, readTaskDueDate } from "@/lib/tasks/due-date";

export const dynamic = "force-dynamic";

// Proactive overdue detection: the board computes "is this task overdue" live,
// but the audit/reminder trail still needs a durable server-side marker. This
// runs on a schedule (see .github/workflows/task-reminders.yml) and stamps
// `overdue_flagged_at` + logs a
// `went_overdue` activity entry the moment it first detects a breach,
// independent of anyone looking at the board.
export async function GET(request: Request) {
  const authResult = checkCronAuthorization(request);
  if (authResult === "misconfigured") {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (authResult === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await runReminderSweep();
  } catch (error) {
    // Every `throw` below sits inside a Promise.all callback, so without this
    // the rejection escapes the handler and Next answers with a bare 500 and
    // an EMPTY body. That is exactly how this cron failed silently for five
    // hours on 2026-08-16: the schedule reported "exit code 22" and the
    // response carried nothing to diagnose. Log the stack for the platform log
    // and return the message so the caller can see it too.
    const message = error instanceof Error ? error.message : String(error);
    console.error("check-overdue cron failed", error);
    return NextResponse.json(
      { error: message, stage: "reminder-sweep" },
      { status: 500 }
    );
  }
}

async function runReminderSweep(): Promise<NextResponse> {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();
  const { data: settingsRow, error: settingsError } = await supabase
    .from("task_reminder_settings")
    .select("*")
    .maybeSingle();
  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 500 });
  }

  const settings = resolveReminderSettings(settingsRow);
  const todoReminderMs = settings.todoHours * 3600_000;
  const overdueReminderMs = settings.overdueReminderHours * 3600_000;
  const waitingReminderMs = settings.waitingHours * 3600_000;
  const staleReminderMs = settings.staleHours * 3600_000;
  const qcReminderMs = settings.qcHours * 3600_000;
  const todoCutoffIso = new Date(now.getTime() - todoReminderMs).toISOString();
  const waitingCutoffIso = new Date(now.getTime() - waitingReminderMs).toISOString();
  const qcCutoffIso = new Date(now.getTime() - qcReminderMs).toISOString();

  const { data: taskRows, error: tasksError } = await supabase
    .from("tasks")
    .select(
      "id,status,priority,category_id,agent_email,in_progress_at,in_progress_seconds,waiting_started_at,waiting_seconds,overdue_flagged_at,overdue_reminded_at,due_soon_notified_at,sla_minutes,overdue_count"
    )
    .eq("status", "in_progress")
    .is("archived_at", null)
    .not("in_progress_at", "is", null);
  if (tasksError) return NextResponse.json({ error: tasksError.message }, { status: 500 });

  const tasks = (taskRows ?? []) as Pick<
    TaskRow,
    | "id"
    | "status"
    | "priority"
    | "category_id"
    | "agent_email"
    | "in_progress_at"
    | "in_progress_seconds"
    | "waiting_started_at"
    | "waiting_seconds"
    | "overdue_flagged_at"
    | "overdue_reminded_at"
    | "due_soon_notified_at"
    | "sla_minutes"
    | "overdue_count"
  >[];

  let rules: TaskSlaRule[] = [];
  if (tasks.length > 0) {
    const { data: rulesData, error: rulesError } = await supabase
      .from("task_sla_rules")
      .select("priority,category_id,duration_minutes");
    if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });
    rules = (rulesData ?? []) as TaskSlaRule[];
  }

  const newlyOverdue = tasks.filter(
    (task) => !task.overdue_flagged_at && isTaskOverdue(task, rules, now)
  );

  // Reminders go out only while the task is actively overdue in In Progress.
  // The UI may already be unlocked after a reason is entered, but the task is
  // still over SLA until it leaves In Progress. At most one reminder per 24h.
  const stillOverdue = tasks.filter(
    (task) =>
      Boolean(task.overdue_flagged_at) &&
      isTaskOverdue(task, rules, now) &&
      intervalDue(task.overdue_reminded_at, overdueReminderMs, now)
  );

  const dueSoonTasks = tasks.filter(
    (task) =>
      !task.due_soon_notified_at &&
      isDueSoon(task, rules, settings.dueSoonMinutes, now)
  );

  const { data: todoRows, error: todoError } = await supabase
    .from("tasks")
    .select("id,todo_started_at,todo_reminded_at")
    .eq("status", "todo")
    .is("archived_at", null)
    .not("todo_started_at", "is", null)
    .lte("todo_started_at", todoCutoffIso);
  if (todoError) return NextResponse.json({ error: todoError.message }, { status: 500 });
  const todoReminderTasks = (
    (todoRows ?? []) as Pick<
      TaskRow,
      "id" | "todo_started_at" | "todo_reminded_at"
    >[]
  ).filter(
    (task) =>
      intervalDue(task.todo_reminded_at, todoReminderMs, now)
  );

  // Task có đặt Due Date và chưa kết thúc. Lọc "quá hạn hay chưa" ở Node chứ
  // không ở SQL: ranh giới ngày phụ thuộc múi giờ Texas, và nhét phép đổi múi
  // giờ vào PostgREST là để hai nơi định nghĩa "hết ngày" theo hai cách.
  const { data: dueRows, error: dueError } = await supabase
    .from("tasks")
    .select(
      "id,status,agent_email,custom_values,due_overdue_flagged_at,due_overdue_reminded_at"
    )
    .is("archived_at", null)
    .not("status", "in", "(done,cancel)")
    .not("custom_values->>due_date", "is", null);
  if (dueError) return NextResponse.json({ error: dueError.message }, { status: 500 });

  type DueTaskRow = Pick<TaskRow, "id" | "status" | "agent_email" | "custom_values"> & {
    due_overdue_flagged_at: string | null;
    due_overdue_reminded_at: string | null;
  };
  const dueTasks = ((dueRows ?? []) as DueTaskRow[]).filter((task) =>
    isTaskRowDueDateOverdue(task, now)
  );
  // Lần đầu vỡ hạn — RPC là cổng chống bắn trùng khi hai lượt cron chồng nhau.
  const newlyDueOverdue = dueTasks.filter((task) => !task.due_overdue_flagged_at);
  // Vẫn đang vỡ hạn — nhắc lại mỗi 24 giờ, đúng như người dùng chốt.
  const stillDueOverdue = dueTasks.filter(
    (task) =>
      Boolean(task.due_overdue_flagged_at) &&
      intervalDue(task.due_overdue_reminded_at, 24 * 3600_000, now)
  );

  const { data: waitingRows, error: waitingError } = await supabase
    .from("tasks")
    .select("id,waiting_started_at,waiting_reminded_at")
    .eq("status", "waiting")
    .is("archived_at", null)
    .not("waiting_started_at", "is", null)
    .lte("waiting_started_at", waitingCutoffIso);
  if (waitingError) return NextResponse.json({ error: waitingError.message }, { status: 500 });
  const waitingReminderTasks = (
    (waitingRows ?? []) as Pick<
      TaskRow,
      "id" | "waiting_started_at" | "waiting_reminded_at"
    >[]
  ).filter(
    (task) =>
      intervalDue(task.waiting_reminded_at, waitingReminderMs, now)
  );

  const { data: staleRows, error: staleError } = await supabase
    .from("tasks")
    .select("id,status,last_activity_at,stale_reminded_at")
    .in("status", ["todo", "in_progress", "waiting"])
    .is("archived_at", null);
  if (staleError) return NextResponse.json({ error: staleError.message }, { status: 500 });
  const staleReminderTasks = (
    (staleRows ?? []) as Pick<
      TaskRow,
      "id" | "status" | "last_activity_at" | "stale_reminded_at"
    >[]
  ).filter(
    (task) =>
      isStale(task, settings.staleHours, now) &&
      intervalDue(task.stale_reminded_at, staleReminderMs, now)
  );

  // Tasks that have been Done/Cancelled for longer than qcHours without a QC
  // review yet — nudge the agent owner/assistants (config in SLA settings).
  const { data: qcRows, error: qcError } = await supabase
    .from("tasks")
    .select("id,agent_email,closed_at,qc_reminded_at")
    .in("status", ["done", "cancel"])
    .is("done_reviewed_by_email", null)
    .is("archived_at", null)
    .not("closed_at", "is", null)
    .lte("closed_at", qcCutoffIso);
  if (qcError) return NextResponse.json({ error: qcError.message }, { status: 500 });
  const qcStaleTasks = (
    (qcRows ?? []) as Pick<
      TaskRow,
      "id" | "agent_email" | "closed_at" | "qc_reminded_at"
    >[]
  ).filter((task) => intervalDue(task.qc_reminded_at, qcReminderMs, now));

  if (newlyOverdue.length > 0) {
    await Promise.all(
      newlyOverdue.map(async (task) => {
        const dueAt = currentStintDueAt(task, rules) ?? now;
        const { data: transitioned, error: transitionError } = await supabase.rpc(
          "mark_task_overdue_atomic",
          {
            p_task_id: task.id,
            p_due_at: dueAt.toISOString(),
            p_sla_minutes: effectiveSlaMinutes(task, rules),
          }
        );
        if (transitionError) throw new Error(transitionError.message);
        // A concurrent cron run or a user status change won the row guard.
        // Nothing below is part of the transition, so it must not notify twice.
        if (transitioned !== true) return;
        const [assignees, agentRecipients, adminRecipients] = await Promise.all([
          fetchTaskAssigneeEmails(task.id, supabase),
          task.priority === "urgent" || task.priority === "high"
            ? fetchAgentOwnerAndAssistantEmails(task.agent_email)
            : Promise.resolve([]),
          task.priority === "urgent" || task.priority === "high"
            ? fetchAdminEmails()
            : Promise.resolve([]),
        ]);
        const escalationRecipients = uniqueNotificationRecipients(
          [...agentRecipients, ...adminRecipients],
          assignees
        );
        const rows: NotificationInsertInput[] = uniqueNotificationRows([
          ...assignees.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "overdue" as const,
            actor_email: "system",
          })),
          ...escalationRecipients.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "sla_escalated" as const,
            actor_email: "system",
            detail: `${task.priority} task breached SLA`,
          })),
        ]);
        await insertNotifications(rows);
      })
    );
    await broadcastTasksChanged();
  }

  if (stillOverdue.length > 0) {
    await Promise.all(
      stillOverdue.map(async (task) => {
        const assignees = await fetchTaskAssigneeEmails(task.id, supabase);
        await insertNotifications(
          assignees.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "overdue_reminder",
            actor_email: "system",
          }))
        );
        const { error: updateError } = await supabase
          .from("tasks")
          .update({ overdue_reminded_at: nowIso })
          .eq("id", task.id)
          .eq("status", "in_progress")
          .not("overdue_flagged_at", "is", null);
        if (updateError) throw new Error(updateError.message);
      })
    );
  }

  if (waitingReminderTasks.length > 0) {
    await Promise.all(
      waitingReminderTasks.map(async (task) => {
        const assignees = await fetchTaskAssigneeEmails(task.id, supabase);
        await insertNotifications(
          assignees.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "waiting_reminder",
            actor_email: "system",
          }))
        );
        const { error: updateError } = await supabase
          .from("tasks")
          .update({ waiting_reminded_at: nowIso })
          .eq("id", task.id)
          .eq("status", "waiting");
        if (updateError) throw new Error(updateError.message);
      })
    );
  }

  if (todoReminderTasks.length > 0) {
    await Promise.all(
      todoReminderTasks.map(async (task) => {
        const assignees = await fetchTaskAssigneeEmails(task.id, supabase);
        await insertNotifications(
          assignees.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "todo_reminder",
            actor_email: "system",
          }))
        );
        const { error: updateError } = await supabase
          .from("tasks")
          .update({ todo_reminded_at: nowIso })
          .eq("id", task.id)
          .eq("status", "todo");
        if (updateError) throw new Error(updateError.message);
      })
    );
  }

  if (dueSoonTasks.length > 0) {
    await Promise.all(
      dueSoonTasks.map(async (task) => {
        const [assignees, agentRecipients] = await Promise.all([
          fetchTaskAssigneeEmails(task.id, supabase),
          task.priority === "urgent" || task.priority === "high"
            ? fetchAgentOwnerAndAssistantEmails(task.agent_email)
            : Promise.resolve([]),
        ]);
        const escalationRecipients = uniqueNotificationRecipients(
          agentRecipients,
          assignees
        );
        const rows: NotificationInsertInput[] = uniqueNotificationRows([
          ...assignees.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "due_soon" as const,
            actor_email: "system",
          })),
          ...escalationRecipients.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "sla_escalated" as const,
            actor_email: "system",
            detail: `${task.priority} task is due soon`,
          })),
        ]);
        await insertNotifications(rows);
        const { error: updateError } = await supabase
          .from("tasks")
          .update({ due_soon_notified_at: nowIso })
          .eq("id", task.id)
          .eq("status", "in_progress")
          .is("due_soon_notified_at", null);
        if (updateError) throw new Error(updateError.message);
      })
    );
  }

  if (staleReminderTasks.length > 0) {
    await Promise.all(
      staleReminderTasks.map(async (task) => {
        const assignees = await fetchTaskAssigneeEmails(task.id, supabase);
        await insertNotifications(
          assignees.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "stale",
            actor_email: "system",
          }))
        );
        const { error: updateError } = await supabase
          .from("tasks")
          .update({ stale_reminded_at: nowIso })
          .eq("id", task.id)
          .in("status", ["todo", "in_progress", "waiting"]);
        if (updateError) throw new Error(updateError.message);
      })
    );
  }

  if (qcStaleTasks.length > 0) {
    await Promise.all(
      qcStaleTasks.map(async (task) => {
        const recipients = await fetchAgentOwnerAndAssistantEmails(
          task.agent_email
        );
        await insertNotifications(
          recipients.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "qc_stale",
            actor_email: "system",
          }))
        );
        const { error: updateError } = await supabase
          .from("tasks")
          .update({ qc_reminded_at: nowIso })
          .eq("id", task.id)
          .in("status", ["done", "cancel"])
          .is("done_reviewed_by_email", null);
        if (updateError) throw new Error(updateError.message);
      })
    );
  }

  // Người nhận: người được giao, agent của task, assistant của agent đó, và
  // admin. Khác SLA — SLA chỉ leo thang lên agent/admin khi priority là
  // urgent/high; Due Date thì LUÔN báo cả bốn nhóm vì đây là hạn cứng do admin
  // đặt, người dùng chốt nó quan trọng hơn SLA.
  const dueRecipients = async (task: { id: string; agent_email: string | null }) => {
    const [assignees, agentRecipients, adminRecipients] = await Promise.all([
      fetchTaskAssigneeEmails(task.id, supabase),
      // Hàm này đã gộp sẵn agent VÀ assistant của agent đó.
      fetchAgentOwnerAndAssistantEmails(task.agent_email),
      fetchAdminEmails(),
    ]);
    // Người được giao chỉ nhận MỘT thông báo dù họ cũng là agent hay admin.
    const watchers = uniqueNotificationRecipients(
      [...agentRecipients, ...adminRecipients],
      assignees
    );
    return [...assignees, ...watchers];
  };

  if (newlyDueOverdue.length > 0) {
    await Promise.all(
      newlyDueOverdue.map(async (task) => {
        const dueDate = readTaskDueDate(task.custom_values) ?? "";
        const { data: flagged, error: flagError } = await supabase.rpc(
          "mark_task_due_date_overdue_atomic",
          { p_task_id: task.id, p_due_date: dueDate }
        );
        if (flagError) throw new Error(flagError.message);
        // Lượt cron khác, hoặc một thao tác của người dùng, đã thắng cổng này.
        // Không có gì bên dưới thuộc về lần chuyển trạng thái đó, nên không
        // được bắn thông báo lần hai.
        if (flagged !== true) return;

        const rows: NotificationInsertInput[] = uniqueNotificationRows(
          (await dueRecipients(task)).map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "due_date_overdue" as const,
            actor_email: "system",
            detail: `Due ${dueDate}`,
          }))
        );
        await insertNotifications(rows);
      })
    );
  }

  if (stillDueOverdue.length > 0) {
    await Promise.all(
      stillDueOverdue.map(async (task) => {
        // Chốt dấu nhắc TRƯỚC khi gửi, và chỉ ghi khi giá trị chưa đổi. Gửi
        // trước rồi mới ghi dấu thì một lượt cron chồng lên sẽ gửi lần hai.
        const { data: updated, error: markError } = await supabase
          .from("tasks")
          .update({ due_overdue_reminded_at: nowIso })
          .eq("id", task.id)
          .eq("due_overdue_reminded_at", task.due_overdue_reminded_at)
          .select("id");
        if (markError) throw new Error(markError.message);
        if ((updated ?? []).length === 0) return;

        const dueDate = readTaskDueDate(task.custom_values) ?? "";
        const rows: NotificationInsertInput[] = uniqueNotificationRows(
          (await dueRecipients(task)).map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "due_date_overdue_reminder" as const,
            actor_email: "system",
            detail: `Due ${dueDate}`,
          }))
        );
        await insertNotifications(rows);
      })
    );
  }

  return NextResponse.json({
    checked: tasks.length,
    flagged: newlyOverdue.length,
    reminded: stillOverdue.length,
    todoReminded: todoReminderTasks.length,
    waitingReminded: waitingReminderTasks.length,
    dueSoon: dueSoonTasks.length,
    stale: staleReminderTasks.length,
    qcStale: qcStaleTasks.length,
    // Cron này từng hỏng im lặng năm tiếng liền (xem chú thích đầu file); con
    // số trong phản hồi là thứ duy nhất nói được nó có làm gì không.
    dueDateOverdue: newlyDueOverdue.length,
    dueDateOverdueReminders: stillDueOverdue.length,
  });
}

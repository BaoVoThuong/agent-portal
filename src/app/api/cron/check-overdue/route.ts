import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { currentStintDueAt, effectiveSlaMinutes, isTaskOverdue } from "@/lib/tasks/sla";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";
import { fetchTaskAssigneeEmails } from "@/lib/tasks/assignees";
import { openOverdueEvent } from "@/lib/tasks/history";
import { insertNotifications } from "@/lib/tasks/notifications";
import { resolveReminderSettings } from "@/lib/tasks/reminder-settings";
import { intervalDue, isDueSoon, isStale } from "@/lib/tasks/reminders";
import type { TaskRow, TaskSlaRule } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

// Proactive overdue detection: the board computes "is this task overdue" live,
// but the audit/reminder trail still needs a durable server-side marker. This
// runs on a schedule (see vercel.json) and stamps `overdue_flagged_at` + logs a
// `went_overdue` activity entry the moment it first detects a breach,
// independent of anyone looking at the board.
function checkAuthorization(request: Request): "ok" | "misconfigured" | "unauthorized" {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return "misconfigured";
  const url = new URL(request.url);
  const authHeader = request.headers.get("authorization");
  const ok =
    authHeader === `Bearer ${cronSecret}` || url.searchParams.get("secret") === cronSecret;
  return ok ? "ok" : "unauthorized";
}

export async function GET(request: Request) {
  const authResult = checkAuthorization(request);
  if (authResult === "misconfigured") {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (authResult === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const overdueReminderMs = settings.overdueReminderHours * 3600_000;
  const waitingReminderMs = settings.waitingHours * 3600_000;
  const staleReminderMs = settings.staleHours * 3600_000;
  const waitingCutoffIso = new Date(now.getTime() - waitingReminderMs).toISOString();

  const { data: taskRows, error: tasksError } = await supabase
    .from("tasks")
    .select(
      "id,status,priority,category_id,in_progress_at,in_progress_seconds,waiting_started_at,waiting_seconds,overdue_flagged_at,overdue_reminded_at,due_soon_notified_at,sla_minutes,overdue_count"
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

  if (newlyOverdue.length > 0) {
    await Promise.all(
      newlyOverdue.map(async (task) => {
        const dueAt = currentStintDueAt(task, rules) ?? now;
        const { error: updateError } = await supabase
          .from("tasks")
          .update({
            overdue_flagged_at: nowIso,
            overdue_reminded_at: nowIso,
            overdue_count: task.overdue_count + 1,
          })
          .eq("id", task.id)
          .is("overdue_flagged_at", null);
        if (updateError) throw new Error(updateError.message);
        await openOverdueEvent(supabase, {
          taskId: task.id,
          dueAt: dueAt.toISOString(),
          overdueAt: nowIso,
          slaMinutes: effectiveSlaMinutes(task, rules),
        });
        await supabase.from("task_activity").insert({
          task_id: task.id,
          actor_email: "system",
          type: "went_overdue",
          meta: { due_at: dueAt.toISOString(), flagged_at: nowIso },
        });
        const assignees = await fetchTaskAssigneeEmails(task.id, supabase);
        await insertNotifications(
          assignees.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "overdue",
            actor_email: "system",
          }))
        );
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

  if (dueSoonTasks.length > 0) {
    await Promise.all(
      dueSoonTasks.map(async (task) => {
        const assignees = await fetchTaskAssigneeEmails(task.id, supabase);
        await insertNotifications(
          assignees.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "due_soon",
            actor_email: "system",
          }))
        );
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

  return NextResponse.json({
    checked: tasks.length,
    flagged: newlyOverdue.length,
    reminded: stillOverdue.length,
    waitingReminded: waitingReminderTasks.length,
    dueSoon: dueSoonTasks.length,
    stale: staleReminderTasks.length,
  });
}

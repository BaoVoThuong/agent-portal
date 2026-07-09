import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { effectiveSlaMinutes, isTaskOverdue, slaDeadline } from "@/lib/tasks/sla";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";
import { fetchTaskAssigneeEmails } from "@/lib/tasks/assignees";
import { insertNotifications } from "@/lib/tasks/notifications";
import type { TaskRow, TaskSlaRule } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WAITING_REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;

// Proactive overdue detection: the board itself only computes "is this task
// overdue" on demand (no cron needed for the UI), but that means an assignee
// who bounces status right before a breach can keep a task from ever
// visibly going overdue. This runs on a schedule (see vercel.json) and
// stamps `overdue_flagged_at` + logs a `went_overdue` activity entry the
// moment it first detects a breach — independent of anyone looking at the
// board, so it can't be dodged by acting fast. `overdue_flagged_at` is
// cleared whenever the SLA clock restarts (see transitions.ts /
// overdue-unlock / reopen), so this naturally re-arms each cycle.
function checkAuthorization(request: Request): "ok" | "misconfigured" | "unauthorized" {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return "misconfigured";
  const url = new URL(request.url);
  const authHeader = request.headers.get("authorization");
  const ok =
    authHeader === `Bearer ${cronSecret}` || url.searchParams.get("secret") === cronSecret;
  return ok ? "ok" : "unauthorized";
}

function reminderDue(lastReminderIso: string | null | undefined, now: Date): boolean {
  if (!lastReminderIso) return true;
  const lastReminderTime = new Date(lastReminderIso).getTime();
  return Number.isNaN(lastReminderTime) || now.getTime() - lastReminderTime >= REMINDER_INTERVAL_MS;
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
  const waitingCutoffIso = new Date(now.getTime() - WAITING_REMINDER_AFTER_MS).toISOString();

  const { data: taskRows, error: tasksError } = await supabase
    .from("tasks")
    .select(
      "id,status,priority,category_id,in_progress_at,overdue_flagged_at,overdue_reminded_at,sla_minutes,overdue_count"
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
    | "overdue_flagged_at"
    | "overdue_reminded_at"
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

  // Already-flagged overdue tasks get a reminder at most once per 24h.
  const stillOverdue = tasks.filter(
    (task) =>
      Boolean(task.overdue_flagged_at) &&
      reminderDue(task.overdue_reminded_at, now)
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
      reminderDue(task.waiting_reminded_at, now)
  );

  if (newlyOverdue.length > 0) {
    await Promise.all(
      newlyOverdue.map(async (task) => {
        const minutes = effectiveSlaMinutes(task, rules);
        const dueAt = slaDeadline(task.in_progress_at as string, minutes);
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

  return NextResponse.json({
    checked: tasks.length,
    flagged: newlyOverdue.length,
    reminded: stillOverdue.length,
    waitingReminded: waitingReminderTasks.length,
  });
}

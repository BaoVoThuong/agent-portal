import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { effectiveSlaMinutes, isTaskOverdue, slaDeadline } from "@/lib/tasks/sla";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";
import type { TaskRow, TaskSlaRule } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  const authResult = checkAuthorization(request);
  if (authResult === "misconfigured") {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (authResult === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: taskRows, error: tasksError } = await supabase
    .from("tasks")
    .select("id,status,priority,category_id,in_progress_at,overdue_flagged_at,sla_minutes")
    .eq("status", "in_progress")
    .is("overdue_flagged_at", null)
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
    | "sla_minutes"
  >[];

  if (tasks.length === 0) {
    return NextResponse.json({ checked: 0, flagged: 0 });
  }

  const { data: rulesData, error: rulesError } = await supabase
    .from("task_sla_rules")
    .select("priority,category_id,duration_minutes");
  if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });
  const rules = (rulesData ?? []) as TaskSlaRule[];

  const now = new Date();
  const newlyOverdue = tasks.filter((task) => isTaskOverdue(task, rules, now));

  if (newlyOverdue.length > 0) {
    const nowIso = now.toISOString();
    await Promise.all(
      newlyOverdue.map(async (task) => {
        const minutes = effectiveSlaMinutes(task, rules);
        const dueAt = slaDeadline(task.in_progress_at as string, minutes);
        await supabase
          .from("tasks")
          .update({ overdue_flagged_at: nowIso })
          .eq("id", task.id)
          .is("overdue_flagged_at", null);
        await supabase.from("task_activity").insert({
          task_id: task.id,
          actor_email: "system",
          type: "went_overdue",
          meta: { due_at: dueAt.toISOString(), flagged_at: nowIso },
        });
      })
    );
    await broadcastTasksChanged();
  }

  return NextResponse.json({ checked: tasks.length, flagged: newlyOverdue.length });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin } from "@/lib/tasks/access";
import {
  resolveReminderSettings,
  type ReminderSettings,
} from "@/lib/tasks/reminder-settings";

export const dynamic = "force-dynamic";

type ReminderSettingsBody = Partial<ReminderSettings> & {
  due_soon_minutes?: unknown;
  todo_hours?: unknown;
  overdue_reminder_hours?: unknown;
  waiting_hours?: unknown;
  stale_hours?: unknown;
  qc_hours?: unknown;
};

function positiveInt(value: unknown): number | null {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return Math.round(numberValue);
}

function parseSettingsBody(body: ReminderSettingsBody | null): ReminderSettings | null {
  if (!body) return null;

  const settings = {
    dueSoonMinutes: positiveInt(body.dueSoonMinutes ?? body.due_soon_minutes),
    todoHours: positiveInt(body.todoHours ?? body.todo_hours),
    overdueReminderHours: positiveInt(
      body.overdueReminderHours ?? body.overdue_reminder_hours
    ),
    waitingHours: positiveInt(body.waitingHours ?? body.waiting_hours),
    staleHours: positiveInt(body.staleHours ?? body.stale_hours),
    qcHours: positiveInt(body.qcHours ?? body.qc_hours),
  };

  if (
    settings.dueSoonMinutes === null ||
    settings.todoHours === null ||
    settings.overdueReminderHours === null ||
    settings.waitingHours === null ||
    settings.staleHours === null ||
    settings.qcHours === null
  ) {
    return null;
  }

  return settings as ReminderSettings;
}

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!actor.isManager) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_reminder_settings")
    .select(
      "due_soon_minutes,todo_hours,overdue_reminder_hours,waiting_hours,stale_hours,qc_hours,updated_at"
    )
    .eq("id", true)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ settings: resolveReminderSettings(data) });
}

export async function PUT(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!actor.isManager) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as ReminderSettingsBody | null;
  const settings = parseSettingsBody(body);
  if (!settings) {
    return NextResponse.json({ error: "Invalid reminder settings." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_reminder_settings")
    .upsert(
      {
        id: true,
        due_soon_minutes: settings.dueSoonMinutes,
        todo_hours: settings.todoHours,
        overdue_reminder_hours: settings.overdueReminderHours,
        waiting_hours: settings.waitingHours,
        stale_hours: settings.staleHours,
        qc_hours: settings.qcHours,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select(
      "due_soon_minutes,todo_hours,overdue_reminder_hours,waiting_hours,stale_hours,qc_hours,updated_at"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ settings: resolveReminderSettings(data) });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin } from "@/lib/tasks/access";
import {
  isReminderSettingKey,
  isReminderSettingValueInBounds,
  resolveReminderSettings,
  type ReminderSettingKey,
} from "@/lib/tasks/reminder-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const actorResult = await requireManager();
  if (!actorResult.ok) return actorResult.response;

  const { data, error } = await getSupabaseAdmin()
    .from("task_reminder_settings")
    .select(
      "due_soon_minutes,todo_hours,overdue_reminder_hours,waiting_hours,stale_hours,qc_hours,updated_at"
    )
    .eq("id", true)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load reminder settings." }, { status: 500 });
  return NextResponse.json({ settings: resolveReminderSettings(data) });
}

export async function PATCH(req: Request) {
  const actorResult = await requireManager();
  if (!actorResult.ok) return actorResult.response;

  const body = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  const key = body?.key;
  const value = body?.value;
  if (!isReminderSettingKey(key) || !isReminderSettingValueInBounds(key, value)) {
    return NextResponse.json({ error: "Invalid reminder setting value." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin().rpc("update_task_reminder_setting_atomic", {
    p_key: key,
    p_value: value,
  });
  if (error) {
    if (error.message === "REMINDER_SETTING_INVALID") {
      return NextResponse.json({ error: "Invalid reminder setting value." }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not save reminder setting." }, { status: 500 });
  }
  return NextResponse.json({ settings: resolveReminderSettings(data) });
}

async function requireManager(): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse }
> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!actor.isManager) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 403 }) };
  }
  return { ok: true };
}

// Keep the route contract explicit for callers during the rolling deploy. Old
// clients that still send a whole settings object must upgrade rather than
// silently reintroduce stale full-object overwrites.
export async function PUT() {
  return NextResponse.json(
    { error: "Use PATCH with one reminder setting key and value." },
    { status: 405, headers: { Allow: "GET, PATCH" } }
  );
}

export type ReminderPatchKey = ReminderSettingKey;

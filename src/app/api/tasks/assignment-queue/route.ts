import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin } from "@/lib/tasks/access";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = buildTaskActor(session.user.permissions, actorEmail, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!actor.isManager) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const enabled = typeof body?.enabled === "boolean" ? body.enabled : null;
  if (!email || enabled === null) {
    return NextResponse.json(
      { error: "email and enabled are required." },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("task_assignment_queue_members")
    .upsert(
      {
        email,
        is_enabled: enabled,
        updated_by_email: actor.email,
        updated_at: nowIso,
      },
      { onConflict: "email" }
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await broadcastTasksChanged();
  return NextResponse.json({ email, enabled, updatedAt: nowIso });
}

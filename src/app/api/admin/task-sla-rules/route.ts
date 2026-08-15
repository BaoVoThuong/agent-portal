import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canAccessBoard, isTaskViewAdmin } from "@/lib/tasks/access";
import { SLA_DURATION_BOUNDS, isSlaDurationInBounds, isUuid } from "@/lib/tasks/sla-config";
import { TASK_PRIORITIES } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  // Reads are for anyone on the task board — the client needs SLA rules to
  // render overdue/countdown for CS + agents. Only writes below are admin-only.
  if (!canAccessBoard(actor)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_sla_rules")
    .select("id,priority,category_id,duration_minutes,updated_at");
  if (error) return NextResponse.json({ error: "Could not load SLA rules." }, { status: 500 });

  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!actor.isManager) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const priority = typeof body?.priority === "string" ? body.priority : "";
  if (!TASK_PRIORITIES.includes(priority as (typeof TASK_PRIORITIES)[number])) {
    return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
  }
  const categoryId =
    typeof body?.category_id === "string" && body.category_id.trim() !== ""
      ? body.category_id.trim()
      : null;
  if (categoryId && !isUuid(categoryId)) {
    return NextResponse.json({ error: "Invalid category id." }, { status: 400 });
  }
  const durationMinutes = Number(body?.duration_minutes);
  if (!isSlaDurationInBounds(durationMinutes)) {
    return NextResponse.json(
      {
        error: `duration_minutes must be between ${SLA_DURATION_BOUNDS.minMinutes} and ${SLA_DURATION_BOUNDS.maxMinutes} minutes.`,
      },
      { status: 400 }
    );
  }
  const hasExpected = Object.prototype.hasOwnProperty.call(body ?? {}, "expected_updated_at");
  const expectedUpdatedAt = body?.expected_updated_at;
  if (!hasExpected || (expectedUpdatedAt !== null && typeof expectedUpdatedAt !== "string")) {
    return NextResponse.json({ error: "SLA rule version is required." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin().rpc("save_task_sla_rule_atomic", {
    p_priority: priority,
    p_category_id: categoryId,
    p_duration_minutes: durationMinutes,
    p_expected_updated_at: expectedUpdatedAt,
    p_has_expected: true,
  });
  if (error) return mapSlaMutationError(error);
  return NextResponse.json({ rule: data });
}

// Clears a specific override so that priority+category falls back to the
// priority-only rule, then the hardcoded DEFAULT_SLA_MINUTES.
export async function DELETE(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!actor.isManager) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const priority = typeof body?.priority === "string" ? body.priority : "";
  if (!TASK_PRIORITIES.includes(priority as (typeof TASK_PRIORITIES)[number])) {
    return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
  }
  const categoryId =
    typeof body?.category_id === "string" && body.category_id.trim() !== ""
      ? body.category_id.trim()
      : null;
  if (categoryId && !isUuid(categoryId)) {
    return NextResponse.json({ error: "Invalid category id." }, { status: 400 });
  }
  const hasExpected = Object.prototype.hasOwnProperty.call(body ?? {}, "expected_updated_at");
  const expectedUpdatedAt = body?.expected_updated_at;
  if (!hasExpected || (expectedUpdatedAt !== null && typeof expectedUpdatedAt !== "string")) {
    return NextResponse.json({ error: "SLA rule version is required." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin().rpc("delete_task_sla_rule_atomic", {
    p_priority: priority,
    p_category_id: categoryId,
    p_expected_updated_at: expectedUpdatedAt,
    p_has_expected: true,
  });
  if (error) return mapSlaMutationError(error);
  return NextResponse.json({ ok: true, ...(data ?? {}) });
}

function mapSlaMutationError(error: { code?: string; message?: string }) {
  if (error.message === "SLA_RULE_STALE") {
    return NextResponse.json(
      { error: "This SLA rule changed elsewhere. Reload it before saving again.", code: "SLA_RULE_STALE" },
      { status: 409 }
    );
  }
  if (error.message === "SLA_RULE_VERSION_REQUIRED") {
    return NextResponse.json({ error: "Reload this SLA rule before saving.", code: "SLA_RULE_VERSION_REQUIRED" }, { status: 409 });
  }
  if (error.code === "23505") {
    return NextResponse.json({ error: "Another SLA rule already exists for this priority and category.", code: "SLA_RULE_CONFLICT" }, { status: 409 });
  }
  return NextResponse.json({ error: "Could not save SLA rule." }, { status: 500 });
}

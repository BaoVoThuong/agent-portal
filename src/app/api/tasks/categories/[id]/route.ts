import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canManageCategories } from "@/lib/tasks/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function requireManager() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canManageCategories(actor)) return { error: "Unauthorized" as const, status: 401 };
  return { supabase: getSupabaseAdmin() };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireManager();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = {};
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body?.color === "string") patch.color = body.color.trim() || null;
  if (typeof body?.is_active === "boolean") patch.is_active = body.is_active;
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const { data, error } = await ctx.supabase
    .from("task_categories")
    .update(patch)
    .eq("id", id)
    .select("id,name,color,position")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireManager();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  // Soft delete so tasks that reference it keep their (now-hidden) category.
  const { error } = await ctx.supabase
    .from("task_categories")
    .update({ is_active: false })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

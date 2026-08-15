import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildTaskActor,
  canAccessBoard,
  isTaskViewAdmin,
  canManageCategories,
} from "@/lib/tasks/access";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";
import { parseConfiguredColor } from "@/lib/table-config/value-colors";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  // Reads are for anyone on the board — category labels/filter render for all
  // roles. Only writes (POST below / PATCH+DELETE in [id]) are admin-only.
  if (!canAccessBoard(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_categories")
    .select("id,name,color,position")
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data ?? [] });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!canManageCategories(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  const colorResult = parseConfiguredColor(body?.color);
  if (!colorResult.ok) {
    return NextResponse.json({ error: colorResult.error }, { status: 400 });
  }
  const color = colorResult.color;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_categories")
    .insert({ name, color, created_by: email })
    .select("id,name,color,position")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await broadcastTasksChanged();
  return NextResponse.json({ category: data });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };
const COMMENT_COLUMNS =
  "id,task_id,parent_id,author_email,body,created_at,updated_at,deleted_at";

async function loadAuthorContext(cid: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_comments")
    .select("id,author_email")
    .eq("id", cid)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  const comment = data as { id: string; author_email: string };
  if (comment.author_email !== email)
    return { error: "Forbidden", status: 403 };
  return { supabase, email };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { cid } = await params;
  const ctx = await loadAuthorContext(cid);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  const { data, error } = await ctx.supabase
    .from("task_comments")
    .update({ body: text, updated_at: new Date().toISOString() })
    .eq("id", cid)
    .select(COMMENT_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { cid } = await params;
  const ctx = await loadAuthorContext(cid);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { error } = await ctx.supabase
    .from("task_comments")
    .update({ deleted_at: new Date().toISOString(), body: "" })
    .eq("id", cid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { resolveDisplayNames } from "@/lib/people/display-names";
import { isProviderUuid, loadProviderCollabContext } from "@/lib/providers/collaboration";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

/** Lịch sử sửa của một comment — ai xem được provider thì xem được. */
export async function GET(_request: Request, { params }: Ctx) {
  const { id, cid } = await params;
  if (!isProviderUuid(cid)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const context = await loadProviderCollabContext(id);
  if (!context.ok) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const { data: comment, error: commentError } = await context.supabase
    .from("provider_comments")
    .select("provider_id")
    .eq("id", cid)
    .maybeSingle();
  if (commentError) {
    return NextResponse.json({ error: commentError.message }, { status: 500 });
  }
  if (!comment || (comment as { provider_id: string }).provider_id !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { data, error } = await context.supabase
    .from("provider_comment_edits")
    .select("id,previous_body,edited_by,edited_at")
    .eq("comment_id", cid)
    .order("edited_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const edits = (data ?? []) as Array<{ edited_by: string }>;
  const names = await resolveDisplayNames(edits.map((edit) => edit.edited_by));
  return NextResponse.json({
    edits: edits.map((edit) => ({
      ...edit,
      edited_by_name: names.get(edit.edited_by.trim().toLowerCase()),
    })),
  });
}

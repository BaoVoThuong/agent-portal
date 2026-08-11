import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { loadEnrollmentDetail } from "@/lib/enrollment/detail";
import { loadScopedEnrollmentRecord } from "@/lib/enrollment/scope";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(request.url);
  const beforeCreatedAt = url.searchParams.get("comments_before_created_at");
  const beforeId = url.searchParams.get("comments_before_id");
  const isUuid = (value: string | null) =>
    Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
  const commentsBefore =
    beforeCreatedAt && beforeId && !Number.isNaN(Date.parse(beforeCreatedAt)) && isUuid(beforeId)
      ? { created_at: beforeCreatedAt, id: beforeId }
      : undefined;
  const highlightCommentId = isUuid(url.searchParams.get("comment_id"))
    ? url.searchParams.get("comment_id")
    : undefined;
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const scoped = await loadScopedEnrollmentRecord(id, actorResult.actor);
  if (!scoped.ok) {
    return NextResponse.json({ error: scoped.error }, { status: scoped.status });
  }

  try {
    const supabase = getSupabaseAdmin();
    return NextResponse.json(
      await loadEnrollmentDetail(supabase, id, {
        commentsBefore,
        highlightCommentId,
      })
    );
  } catch (detailError) {
    return NextResponse.json(
      {
        error:
          detailError instanceof Error
            ? detailError.message
            : "Unable to load enrollment detail.",
      },
      { status: 500 }
    );
  }
}

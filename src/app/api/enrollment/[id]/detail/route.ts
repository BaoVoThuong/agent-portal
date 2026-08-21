import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { loadEnrollmentDetail } from "@/lib/enrollment/detail";
import { loadScopedEnrollmentRecord } from "@/lib/enrollment/scope";
import { RouteTiming } from "@/lib/server-timing";
import {
  COMMENT_PAGE_SIZE,
  COMMENT_REFRESH_MAX,
} from "@/lib/collaboration/comment-pagination";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const timing = new RouteTiming("enrollment-detail");
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(status);
    return response;
  };
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
  const requestedCommentLimit = Number(
    url.searchParams.get("comments_limit") ?? COMMENT_PAGE_SIZE,
  );
  const commentLimit = Number.isInteger(requestedCommentLimit)
    ? Math.min(
        COMMENT_REFRESH_MAX,
        Math.max(COMMENT_PAGE_SIZE, requestedCommentLimit),
      )
    : COMMENT_PAGE_SIZE;
  const actorResult = await timing.measure("auth", () => loadEnrollmentActor());
  if (!actorResult.ok) {
    return respond({ error: actorResult.error }, actorResult.status);
  }

  const scoped = await timing.measure("scope", () =>
    loadScopedEnrollmentRecord(id, actorResult.actor),
  );
  if (!scoped.ok) {
    return respond({ error: scoped.error }, scoped.status);
  }

  try {
    const supabase = getSupabaseAdmin();
    return respond(
      await timing.measure("detail", () =>
        loadEnrollmentDetail(supabase, id, {
          commentsBefore,
          highlightCommentId,
          commentLimit: commentsBefore ? COMMENT_PAGE_SIZE : commentLimit,
          timing,
        }),
      ),
    );
  } catch (detailError) {
    return respond(
      {
        error:
          detailError instanceof Error
            ? detailError.message
            : "Unable to load enrollment detail.",
      },
      500,
    );
  }
}

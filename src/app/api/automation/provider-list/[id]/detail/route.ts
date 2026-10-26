import { NextResponse } from "next/server";
import { RouteTiming } from "@/lib/server-timing";
import {
  COMMENT_PAGE_SIZE,
  COMMENT_REFRESH_MAX,
} from "@/lib/collaboration/comment-pagination";
import {
  fetchProviderViewers,
  isProviderUuid,
  loadProviderActivity,
  loadProviderCollabContext,
  loadProviderComments,
} from "@/lib/providers/collaboration";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** Comments + Activity + người tag được của một provider — nạp khi mở dialog. */
export async function GET(request: Request, { params }: Ctx) {
  const timing = new RouteTiming("provider-detail");
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(status);
    return response;
  };
  const { id } = await params;
  const url = new URL(request.url);
  const section = url.searchParams.get("section");
  const beforeCreatedAt = url.searchParams.get("comments_before_created_at");
  const beforeId = url.searchParams.get("comments_before_id");
  const commentsBefore =
    beforeCreatedAt && ISO_TIMESTAMP.test(beforeCreatedAt) &&
      Number.isFinite(Date.parse(beforeCreatedAt)) && isProviderUuid(beforeId)
      ? { created_at: beforeCreatedAt, id: beforeId }
      : undefined;
  const requestedLimit = Number(url.searchParams.get("comments_limit") ?? COMMENT_PAGE_SIZE);
  const commentLimit = commentsBefore
    ? COMMENT_PAGE_SIZE
    : Number.isInteger(requestedLimit)
      ? Math.min(COMMENT_REFRESH_MAX, Math.max(COMMENT_PAGE_SIZE, requestedLimit))
      : COMMENT_PAGE_SIZE;

  const context = await timing.measure("access", () => loadProviderCollabContext(id));
  if (!context.ok) return respond({ error: context.error }, context.status);

  try {
    // Mỗi tab tải dữ liệu riêng: danh sách người được tag cần nhiều lượt đọc
    // RBAC, còn activity có thể dài. Chúng không chặn lần hiện comment đầu tiên.
    if (section === "activity") {
      const activity = await timing.measure("activity", () =>
        loadProviderActivity(context.supabase, id)
      );
      return respond({ activity });
    }
    if (section === "members") {
      const members = context.canComment
        ? await timing.measure("members", () => fetchProviderViewers())
        : [];
      return respond({ members });
    }
    const commentPage = await timing.measure("comments", () =>
      loadProviderComments(context.supabase, id, { before: commentsBefore, limit: commentLimit })
    );
    return respond({
      comments: commentPage.comments,
      commentsHasMore: commentPage.hasMore,
      commentsNextCursor: commentPage.nextCursor,
      canComment: context.canComment,
    });
  } catch (error) {
    return respond(
      { error: error instanceof Error ? error.message : "Unable to load provider detail." },
      500
    );
  }
}

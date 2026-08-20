import { NextResponse } from "next/server";
import { RouteTiming } from "@/lib/server-timing";
import { authorizeTaskReactionAccess } from "@/lib/tasks/reaction-access";
import type { ReactionRow } from "@/lib/tasks/reactions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const timing = new RouteTiming("task-comment-reactions");
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(status);
    return response;
  };

  const { id } = await params;
  const access = await timing.measure("access", () =>
    authorizeTaskReactionAccess(id),
  );
  if (!access.ok) return respond({ error: access.error }, access.status);

  const { data, error } = await timing.measure("reaction_query", async () =>
    access.supabase.rpc("task_comment_reactions_for_task", {
      p_task_id: id,
    }),
  );
  if (error) return respond({ error: error.message }, 500);
  return respond({ reactions: (data ?? []) as ReactionRow[] });
}

import { NextResponse } from "next/server";
import { RouteTiming } from "@/lib/server-timing";
import { authorizeEnrollmentReactionAccess } from "@/lib/enrollment/reaction-access";
import type { ReactionRow } from "@/lib/tasks/reactions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const timing = new RouteTiming("enrollment-comment-reactions");
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(status);
    return response;
  };
  const { id } = await params;
  const access = await timing.measure("access", () =>
    authorizeEnrollmentReactionAccess(id),
  );
  if (!access.ok) return respond({ error: access.error }, access.status);

  const { data, error } = await timing.measure("reaction_query", async () =>
    access.supabase.rpc("enrollment_comment_reactions_for_record", {
      p_record_id: id,
    }),
  );
  if (error) return respond({ error: error.message }, 500);
  return respond({ reactions: (data ?? []) as ReactionRow[] });
}

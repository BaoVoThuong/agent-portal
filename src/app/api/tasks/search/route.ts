import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessBoard } from "@/lib/tasks/access";
import { runTaskSearch } from "@/lib/tasks/search";
import { taskActorForUser } from "@/lib/tasks/actor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = await taskActorForUser(session.user, email);
  if (!canAccessBoard(actor)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = await runTaskSearch(actor, q);
  return NextResponse.json(results);
}

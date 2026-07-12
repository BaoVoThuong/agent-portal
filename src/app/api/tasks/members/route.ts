import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildTaskActor, isTaskViewAdmin, canAccessBoard } from "@/lib/tasks/access";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!canAccessBoard(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const members = await fetchTaskAssignees();
  return NextResponse.json({ members });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAssign } from "@/lib/tasks/access";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";
import { taskActorForUser } from "@/lib/tasks/actor";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = await taskActorForUser(session.user, email);
  if (!canAssign(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assignees = await fetchTaskAssignees();
  return NextResponse.json({ assignees });
}

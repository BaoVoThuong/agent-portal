import { NextResponse } from "next/server";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { fetchEnrollmentOverview } from "@/lib/enrollment/overview-data";
import { toEnrollmentProgram } from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  }

  const program = toEnrollmentProgram(new URL(request.url).searchParams.get("program"));
  const snapshot = await fetchEnrollmentOverview(program);
  return NextResponse.json(snapshot);
}

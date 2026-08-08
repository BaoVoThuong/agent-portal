import { NextResponse } from "next/server";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { fetchEnrollmentOverview } from "@/lib/enrollment/overview-data";
import { parseEnrollmentProgram } from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  }

  const program = parseEnrollmentProgram(new URL(request.url).searchParams.get("program"));
  if (!program) {
    return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  }
  const snapshot = await fetchEnrollmentOverview(program);
  return NextResponse.json(snapshot);
}

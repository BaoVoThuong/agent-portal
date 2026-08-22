import { NextResponse } from "next/server";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { fetchAcaOverviewSnapshot } from "@/lib/enrollment/aca-overview-data";
import { parseEnrollmentProgram } from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  if (!actorResult.actor.isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const requestedProgram = url.searchParams.get("program");
  const program = requestedProgram === null ? "aca" : parseEnrollmentProgram(requestedProgram);
  if (!program) return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
  const validDate = (value: string | null) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!validDate(from) || !validDate(to)) return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  if (from && to && from > to) return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  try {
    const snapshot = await fetchAcaOverviewSnapshot({ program, from, to, thresholdDays: url.searchParams.get("thresholdDays") });
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load enrollment overview." }, { status: 500 });
  }
}

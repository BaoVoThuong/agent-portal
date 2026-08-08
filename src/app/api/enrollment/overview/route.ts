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
  try {
    const searchParams = new URL(request.url).searchParams;
    const snapshot = await fetchEnrollmentOverview(program, {
      from: searchParams.has("from") ? searchParams.get("from") : undefined,
      to: searchParams.has("to") ? searchParams.get("to") : undefined,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load enrollment overview." },
      { status: 500 }
    );
  }
}

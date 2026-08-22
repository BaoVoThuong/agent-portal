import { NextResponse } from "next/server";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { fetchEnrollmentOverview } from "@/lib/enrollment/overview-data";
import { parseEnrollmentProgram } from "@/lib/enrollment/types";
import { resolveEnrollmentScope } from "@/lib/enrollment/scope";
import { enrollmentSchemaErrorResponse } from "@/lib/enrollment/schema-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  }
  if (!actorResult.actor.isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const program = parseEnrollmentProgram(new URL(request.url).searchParams.get("program"));
  if (!program) {
    return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  }
  try {
    const searchParams = new URL(request.url).searchParams;
    const scope = await resolveEnrollmentScope(actorResult.actor);
    const snapshot = await fetchEnrollmentOverview(program, scope, {
      from: searchParams.has("from") ? searchParams.get("from") : undefined,
      to: searchParams.has("to") ? searchParams.get("to") : undefined,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    const schemaResponse = enrollmentSchemaErrorResponse(error);
    if (schemaResponse) return schemaResponse;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load enrollment overview." },
      { status: 500 }
    );
  }
}

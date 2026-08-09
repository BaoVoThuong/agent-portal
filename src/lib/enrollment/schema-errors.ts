import { NextResponse } from "next/server";

export type SupabaseLikeError = { code?: string; message?: string } | null | undefined;

export class EnrollmentSchemaOutOfDateError extends Error {
  readonly code = "SCHEMA_OUT_OF_DATE";

  constructor(message = "Enrollment database schema is out of date. Apply the enrollment rollout migration.") {
    super(message);
    this.name = "EnrollmentSchemaOutOfDateError";
  }
}

export function isEnrollmentSchemaOutOfDate(error: SupabaseLikeError): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(
    error?.code === "PGRST202" ||
      ((error?.code === "42703" || error?.code === "PGRST204") &&
        (message.includes("stage_entered_at") ||
          message.includes("stage_entered_source") ||
          message.includes("last_activity_at") ||
          message.includes("last_activity_by_email") ||
          message.includes("enrollment_stage_cycles") ||
          message.includes("create_enrollment_atomic") ||
          message.includes("patch_enrollment_atomic") ||
          message.includes("archive_enrollment_atomic")))
  );
}

export function enrollmentSchemaErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof EnrollmentSchemaOutOfDateError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
  }
  if (isEnrollmentSchemaOutOfDate(error as SupabaseLikeError)) {
    return NextResponse.json(
      { error: "Database migration missing: enrollment stage tracking schema.", code: "SCHEMA_OUT_OF_DATE" },
      { status: 503 }
    );
  }
  return null;
}

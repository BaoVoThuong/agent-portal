import { describe, expect, it } from "vitest";
import { isEnrollmentSchemaOutOfDate } from "@/lib/enrollment/schema-errors";

describe("enrollment schema errors", () => {
  it("only treats tracking-column errors as schema drift", () => {
    expect(isEnrollmentSchemaOutOfDate({ code: "42703", message: "column enrollment_records.stage_entered_at does not exist" })).toBe(true);
    expect(isEnrollmentSchemaOutOfDate({ code: "42703", message: "column unrelated does not exist" })).toBe(false);
    expect(isEnrollmentSchemaOutOfDate({ code: "PGRST202", message: "function patch_enrollment_atomic not found" })).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  assertEnrollmentRecordsComplete,
  EnrollmentListTruncatedError,
} from "@/lib/enrollment/queries";

describe("assertEnrollmentRecordsComplete", () => {
  it("fails closed when PostgREST returns fewer rows than the exact count", () => {
    expect(() => assertEnrollmentRecordsComplete([{ id: "one" }], 2)).toThrow(
      EnrollmentListTruncatedError
    );
  });

  it("accepts complete or count-unavailable responses", () => {
    expect(() => assertEnrollmentRecordsComplete([{ id: "one" }], 1)).not.toThrow();
    expect(() => assertEnrollmentRecordsComplete([{ id: "one" }], null)).not.toThrow();
    expect(() => assertEnrollmentRecordsComplete(null, undefined)).not.toThrow();
  });
});

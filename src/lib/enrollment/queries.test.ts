import { describe, expect, it } from "vitest";
import {
  assertEnrollmentRecordsComplete,
  chunkEnrollmentRecordIds,
  EnrollmentListTruncatedError,
} from "@/lib/enrollment/queries";

describe("chunkEnrollmentRecordIds", () => {
  it("keeps list hydration requests bounded", () => {
    expect(chunkEnrollmentRecordIds(["1", "2", "3", "4", "5"], 2)).toEqual([
      ["1", "2"],
      ["3", "4"],
      ["5"],
    ]);
  });

  it("rejects an invalid chunk size", () => {
    expect(() => chunkEnrollmentRecordIds(["1"], 0)).toThrow(
      "chunkSize must be a positive integer.",
    );
  });
});

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

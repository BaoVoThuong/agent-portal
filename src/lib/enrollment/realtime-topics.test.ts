import { describe, expect, it } from "vitest";
import { enrollmentRoomTopic, enrollmentTopic } from "@/lib/enrollment/realtime-topics";

describe("Enrollment realtime topics", () => {
  it("scopes list changes by program", () => {
    expect(enrollmentTopic("aca")).not.toBe(enrollmentTopic("medicare"));
    expect(enrollmentTopic("aca")).toBe("enrollment-aca-stream");
  });

  it("keeps record rooms independently addressable", () => {
    expect(enrollmentRoomTopic("record-1")).toBe("enrollment-record-1");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  canMutateEnrollmentRecord,
  type EnrollmentActor,
} from "./access";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const manager: EnrollmentActor = {
  email: "manager@example.com",
  isManager: true,
  isWorker: true,
};
const worker: EnrollmentActor = {
  email: "worker@example.com",
  isManager: false,
  isWorker: true,
};
const outsider: EnrollmentActor = {
  email: "outsider@example.com",
  isManager: false,
  isWorker: true,
};

describe("enrollment record access", () => {
  it("allows managers to mutate every record", () => {
    const record = { id: "record-1" };
    expect(canMutateEnrollmentRecord(manager, record)).toBe(true);
  });

  it("allows direct stakeholders to mutate", () => {
    const record = {
      id: "record-1",
      responsible_enroll_email: "Worker@Example.com",
    };
    expect(canMutateEnrollmentRecord(worker, record)).toBe(true);
  });

  it("does not grant mutation rights through comment participation alone", () => {
    const record = { id: "record-1" };
    expect(canMutateEnrollmentRecord(worker, record)).toBe(false);
  });

  it("blocks unrelated workers from mutating", () => {
    const record = {
      id: "record-1",
      caller_email: "worker@example.com",
    };
    expect(canMutateEnrollmentRecord(outsider, record)).toBe(false);
  });
});

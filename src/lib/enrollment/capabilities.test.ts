import { describe, expect, it, vi } from "vitest";
import {
  canCreateEnrollmentWithScope,
  resolveEnrollmentCapabilities,
  type EnrollmentActor,
} from "./access";
import { testEnrollmentActor } from "@/lib/authz/test-actors";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));

const manager: EnrollmentActor = testEnrollmentActor(["task.manage"], "m@x.com", { isAdmin: true });
const worker: EnrollmentActor = testEnrollmentActor(["task.work"], "w@x.com");
const outsider: EnrollmentActor = testEnrollmentActor([], "o@x.com");

describe("resolveEnrollmentCapabilities", () => {
  it("grants every capability to a manager", () => {
    expect(resolveEnrollmentCapabilities(manager)).toEqual({
      canView: true,
      canEditContent: true,
      canEditFields: true,
      canChangeStage: true,
      canReopen: true,
      canReviewQC: true,
      canAssignPeople: true,
      canArchive: true,
      canTransferAgent: true,
    });
  });

  it("grants every capability to an agent owner or assistant", () => {
    const capabilities = resolveEnrollmentCapabilities(worker, {
      isAgentOwner: true,
    });
    expect(capabilities).toEqual({
      canView: true,
      canEditContent: true,
      canEditFields: true,
      canChangeStage: true,
      canReopen: true,
      canReviewQC: true,
      canAssignPeople: true,
      canArchive: true,
      canTransferAgent: true,
    });
  });

  for (const role of ["isCaller", "isResponsible"] as const) {
    it(`lets ${role} edit workflow fields but not perform owner actions`, () => {
      const capabilities = resolveEnrollmentCapabilities(worker, { [role]: true });
      expect(capabilities.canEditContent).toBe(false);
      expect(capabilities.canEditFields).toBe(true);
      expect(capabilities.canChangeStage).toBe(true);
      expect(capabilities.canReopen).toBe(true);
      expect(capabilities.canReviewQC).toBe(false);
      expect(capabilities.canAssignPeople).toBe(false);
      expect(capabilities.canArchive).toBe(false);
      expect(capabilities.canTransferAgent).toBe(false);
    });
  }

  it("lets the creator edit fields and transfer the agent only", () => {
    const capabilities = resolveEnrollmentCapabilities(worker, { isCreator: true });
    expect(capabilities.canEditContent).toBe(true);
    expect(capabilities.canEditFields).toBe(true);
    expect(capabilities.canTransferAgent).toBe(true);
    expect(capabilities.canChangeStage).toBe(false);
    expect(capabilities.canArchive).toBe(false);
  });

  it("lets an unrelated worker view but not mutate", () => {
    const capabilities = resolveEnrollmentCapabilities(worker);
    expect(capabilities.canView).toBe(true);
    expect(capabilities.canEditContent).toBe(false);
    expect(capabilities.canEditFields).toBe(false);
  });

  it("denies a non-worker even when membership flags are supplied", () => {
    expect(
      resolveEnrollmentCapabilities(outsider, { isAgentOwner: true }).canView
    ).toBe(false);
  });
});

describe("canCreateEnrollmentWithScope", () => {
  it("allows managers and scoped workers only", () => {
    expect(canCreateEnrollmentWithScope(manager, false)).toBe(true);
    expect(canCreateEnrollmentWithScope(worker, true)).toBe(true);
    expect(canCreateEnrollmentWithScope(worker, false)).toBe(false);
    expect(canCreateEnrollmentWithScope(outsider, true)).toBe(false);
  });
});

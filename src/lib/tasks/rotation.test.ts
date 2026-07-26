import { describe, expect, it } from "vitest";
import {
  bumpAssignmentRotation,
  computeAssignmentQueueDueAt,
  normalizeAssignmentRotationEmail,
} from "./rotation";
import type { TaskPriority } from "./types";

const now = new Date("2026-07-25T12:00:00.000Z");

function task(priority: TaskPriority = "medium") {
  return { priority, category_id: null, sla_minutes: null };
}

describe("normalizeAssignmentRotationEmail", () => {
  it("normalizes assignment rotation emails", () => {
    expect(normalizeAssignmentRotationEmail("  CS@Example.COM ")).toBe("cs@example.com");
  });
});

describe("computeAssignmentQueueDueAt", () => {
  it("starts from now when no queue row exists", () => {
    expect(computeAssignmentQueueDueAt(null, 60, now).toISOString()).toBe(
      "2026-07-25T13:00:00.000Z"
    );
  });

  it("starts from now when the existing cooldown already expired", () => {
    expect(
      computeAssignmentQueueDueAt("2026-07-25T10:00:00.000Z", 60, now).toISOString()
    ).toBe("2026-07-25T13:00:00.000Z");
  });

  it("stacks on the existing future cooldown", () => {
    expect(
      computeAssignmentQueueDueAt("2026-07-25T14:00:00.000Z", 60, now).toISOString()
    ).toBe("2026-07-25T15:00:00.000Z");
  });
});

describe("bumpAssignmentRotation", () => {
  it("calls the atomic rotation bump rpc with normalized email and effective SLA", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const supabase = {
      async rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return { data: null, error: null };
      },
    };

    await bumpAssignmentRotation(supabase, " CS@Example.COM ", task("urgent"), [], now);

    expect(calls).toEqual([
      {
        fn: "bump_task_assignment_rotation",
        args: {
          p_email: "cs@example.com",
          p_minutes: 60,
          p_now: "2026-07-25T12:00:00.000Z",
        },
      },
    ]);
  });

  it("surfaces rpc failures", async () => {
    const supabase = {
      async rpc() {
        return { data: null, error: { message: "missing rotation table" } };
      },
    };

    await expect(
      bumpAssignmentRotation(supabase, "cs@example.com", task(), [], now)
    ).rejects.toThrow("missing rotation table");
  });
});

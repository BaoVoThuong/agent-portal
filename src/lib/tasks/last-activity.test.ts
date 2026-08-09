import { describe, expect, it } from "vitest";
import { touchLastActivity } from "@/lib/tasks/last-activity";

function fakeDb(committed: string) {
  return {
    from() {
      return {
        update() {
          return {
            eq() {
              return {
                select() {
                  return {
                    single: async () => ({ data: { updated_at: committed }, error: null }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("touchLastActivity", () => {
  it("returns the timestamp committed by the database", async () => {
    const committed = "2026-08-09T10:00:00.000001Z";
    const result = await touchLastActivity(
      fakeDb(committed) as unknown as Parameters<typeof touchLastActivity>[0],
      "task-1",
      "agent@example.com",
      "2026-08-09T10:00:00.000Z"
    );
    expect(result).toBe(committed);
  });
});

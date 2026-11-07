import { describe, expect, it } from "vitest";
import type { UserAccess } from "@/lib/rbac/access";
import { createAccessFallback } from "@/lib/rbac/access-fallback";

const good: UserAccess = {
  userId: "u1",
  permissions: ["task.work"],
  isActive: true,
  agentId: null,
};
const failed: UserAccess = {
  userId: null,
  permissions: [],
  isActive: false,
  agentId: null,
  unavailable: true,
};
const missing: UserAccess = { userId: null, permissions: [], isActive: false, agentId: null };

function setup(maxAgeMs = 1000) {
  let t = 0;
  const fallback = createAccessFallback({ maxAgeMs, now: () => t });
  return { fallback, advance: (ms: number) => (t += ms) };
}

describe("createAccessFallback", () => {
  it("returns a successful read unchanged", () => {
    const { fallback } = setup();
    expect(fallback.resolve("a@x.com", good)).toBe(good);
  });

  it("reuses the last good read when the database read fails", () => {
    const { fallback, advance } = setup();
    fallback.resolve("a@x.com", good);
    advance(999);
    expect(fallback.resolve("a@x.com", failed)).toBe(good);
  });

  it("does not reuse a read older than maxAgeMs", () => {
    const { fallback, advance } = setup();
    fallback.resolve("a@x.com", good);
    advance(1001);
    expect(fallback.resolve("a@x.com", failed)).toBe(failed);
  });

  it("never lends one person's access to another", () => {
    const { fallback } = setup();
    fallback.resolve("a@x.com", good);
    expect(fallback.resolve("b@x.com", failed)).toBe(failed);
  });

  it("a read that finds the account missing replaces the remembered access", () => {
    const { fallback } = setup();
    fallback.resolve("a@x.com", good);
    fallback.resolve("a@x.com", missing);
    expect(fallback.resolve("a@x.com", failed)).toBe(failed);
  });

  it("clear forgets everything (role changes invalidate it)", () => {
    const { fallback } = setup();
    fallback.resolve("a@x.com", good);
    fallback.clear();
    expect(fallback.resolve("a@x.com", failed)).toBe(failed);
  });
});

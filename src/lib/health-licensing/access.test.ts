import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));

import { canManageLicensing, canViewLicensing } from "./access";

describe("licensing access", () => {
  it("lets View and Manage both open the map, and only Manage edit", () => {
    expect(canViewLicensing({ permissions: ["health_licensing.view"] })).toBe(true);
    expect(canViewLicensing({ permissions: ["health_licensing.manage"] })).toBe(true);
    expect(canViewLicensing({ permissions: ["task.manage"] })).toBe(false);
    expect(canManageLicensing({ permissions: ["health_licensing.view"] })).toBe(false);
    expect(canManageLicensing({ permissions: ["health_licensing.manage"] })).toBe(true);
  });
});

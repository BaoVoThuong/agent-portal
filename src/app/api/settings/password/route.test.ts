import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { email: "new@example.com", permissions: [] as string[] } })),
  account: { password_hash: "google-auth", is_active: true } as {
    password_hash: string;
    is_active: boolean;
  } | null,
  updatedAccount: { id: "account-1" } as { id: string } | null,
  update: vi.fn(),
  hash: vi.fn(async () => "$2b$hashed"),
  compare: vi.fn(async () => true),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash, compare: mocks.compare } }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      let writing = false;
      const query = {
        select: () => query,
        eq: () => query,
        update: (value: unknown) => {
          writing = true;
          mocks.update(value);
          return query;
        },
        maybeSingle: async () => ({
          data: writing ? mocks.updatedAccount : mocks.account,
          error: null,
        }),
      };
      return query;
    },
  }),
}));

import { PATCH } from "./route";

function passwordRequest() {
  return new Request("http://localhost/api/settings/password", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "a-new-password" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = { password_hash: "google-auth", is_active: true };
  mocks.updatedAccount = { id: "account-1" };
});

describe("Settings password for signed-in accounts", () => {
  it("allows an active account with no role to set its password", async () => {
    const response = await PATCH(passwordRequest());
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ password_hash: "$2b$hashed" });
  });

  it("refuses a disabled account despite its existing session", async () => {
    mocks.account = { password_hash: "google-auth", is_active: false };
    const response = await PATCH(passwordRequest());
    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses when the account is disabled between read and write", async () => {
    mocks.updatedAccount = null;
    const response = await PATCH(passwordRequest());
    expect(response.status).toBe(403);
  });
});

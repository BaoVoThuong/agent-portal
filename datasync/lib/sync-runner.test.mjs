import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { syncConfig } = require("./sync-runner.js");

const config = {
  name: "health-test",
  table: "health_raw_data",
  sheetId: "sheet-1",
  gid: "42",
  columns: [{ source: "agent", target: "agent" }],
};

function fakeNetwork(finalize = () => new Response("1")) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ method: init.method ?? "GET", url });
    if (url.hostname === "docs.google.com") return new Response("agent\nann@example.com\n");
    if (url.pathname === "/rest/v1/rpc/finalize_sheet_sync") return finalize();
    if (url.pathname.startsWith("/rest/v1/rpc/")) return new Response("");
    return new Response(null, { status: 201 });
  }));
  return calls;
}

describe("syncConfig", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://db.example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("leaves pruning to the database after a successful sync", async () => {
    const calls = fakeNetwork();
    await syncConfig(config);
    expect(calls.some((call) => call.url.pathname.endsWith("/finalize_sheet_sync"))).toBe(true);
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("does not suggest resuming a superseded run", async () => {
    fakeNetwork(() => new Response("SUPERSEDED_RUN: newer run finalized", { status: 400 }));
    await expect(syncConfig(config)).rejects.toThrow("SUPERSEDED_RUN");
    const logs = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logs).toContain("Nothing to resume");
    expect(logs).not.toContain("--resume-run");
  });

  it("still prints resume instructions for other finalize errors", async () => {
    fakeNetwork(() => new Response("statement timeout", { status: 500 }));
    await expect(syncConfig(config)).rejects.toThrow("finalize_sheet_sync");
    const logs = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logs).toContain("--resume-run");
  });
});

import { createRequire } from "node:module";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type SyncConfig = {
  name: string;
};

const require = createRequire(import.meta.url);
const { listConfigs, loadConfig } = require("../../../../../datasync/lib/configs") as {
  listConfigs: () => string[];
  loadConfig: (name: string) => SyncConfig;
};
const { syncConfig } = require("../../../../../datasync/lib/sync-runner") as {
  syncConfig: (config: SyncConfig) => Promise<void>;
};

type AuthResult = "ok" | "misconfigured" | "unauthorized";

function checkAuthorization(request: Request): AuthResult {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return "misconfigured";

  const url = new URL(request.url);
  const authHeader = request.headers.get("authorization");
  const ok =
    authHeader === `Bearer ${cronSecret}` ||
    url.searchParams.get("secret") === cronSecret;

  return ok ? "ok" : "unauthorized";
}

function getConfigNames(request: Request) {
  const url = new URL(request.url);
  const configParam = url.searchParams.get("config")?.trim();
  if (!configParam || configParam === "all") return listConfigs();

  return configParam
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const authResult = checkAuthorization(request);
  if (authResult === "misconfigured") {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }
  if (authResult === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configNames = getConfigNames(request);
  const startedAt = new Date().toISOString();
  const synced: string[] = [];

  try {
    for (const configName of configNames) {
      const config = loadConfig(configName);
      await syncConfig(config);
      synced.push(config.name);
    }

    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      synced,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Sync failed",
        synced,
      },
      { status: 500 }
    );
  }
}

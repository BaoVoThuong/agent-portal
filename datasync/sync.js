#!/usr/bin/env node

const path = require("node:path");
const { loadEnv } = require("./lib/env");
const { listConfigs, loadConfig } = require("./lib/configs");
const { syncConfig } = require("./lib/sync-runner");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const args = {
    config: "health-mart",
    dryRun: false,
    limit: null,
    list: false,
    resumeRun: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--config") args.config = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--list") args.list = true;
    else if (arg === "--resume-run") args.resumeRun = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function main() {
  loadEnv(path.resolve(__dirname, "../.env.local"));

  const args = parseArgs(process.argv);
  if (args.list) {
    if (args.resumeRun) throw new Error("--resume-run cannot be used with --list");
    console.log(listConfigs().join("\n"));
    return;
  }

  if (args.resumeRun && args.config === "all") {
    throw new Error("--resume-run requires one --config target.");
  }
  if (args.resumeRun && !UUID_RE.test(args.resumeRun)) {
    throw new Error("--resume-run must be a valid UUID.");
  }
  if (args.resumeRun && (args.dryRun || args.limit !== null)) {
    throw new Error("--resume-run cannot be combined with --dry-run or --limit.");
  }

  const configNames = args.config === "all" ? listConfigs() : [args.config];
  for (const configName of configNames) {
    const config = loadConfig(configName);
    await syncConfig(config, {
      dryRun: args.dryRun,
      limit: args.limit,
      resumeRun: args.resumeRun,
    });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

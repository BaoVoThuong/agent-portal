#!/usr/bin/env node

const path = require("node:path");
const { loadEnv } = require("./lib/env");
const { listConfigs, loadConfig } = require("./lib/configs");
const { syncConfig } = require("./lib/sync-runner");

function parseArgs(argv) {
  const args = {
    config: "health-mart",
    dryRun: false,
    limit: null,
    list: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--config") args.config = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--list") args.list = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function main() {
  loadEnv(path.resolve(__dirname, "../.env.local"));

  const args = parseArgs(process.argv);
  if (args.list) {
    console.log(listConfigs().join("\n"));
    return;
  }

  const configNames = args.config === "all" ? listConfigs() : [args.config];
  for (const configName of configNames) {
    const config = loadConfig(configName);
    await syncConfig(config, {
      dryRun: args.dryRun,
      limit: args.limit,
    });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

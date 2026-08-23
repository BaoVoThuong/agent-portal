#!/usr/bin/env node

/**
 * Seed isolated enrollment rows for list/scope performance checks.
 *
 * Safety rules:
 * - rows are identified by both PERF_SAMPLE_MARKER and PERF_SAMPLE_PREFIX;
 * - writes/deletes require SEED_PERF_ALLOW=1;
 * - --dry-run never writes;
 * - --cleanup only removes rows created by this script.
 *
 * Examples:
 *   node scripts/seed-enrollment-performance-samples.mjs --count=500 --dry-run
 *   SEED_PERF_ALLOW=1 node scripts/seed-enrollment-performance-samples.mjs --count=500
 *   SEED_PERF_ALLOW=1 node scripts/seed-enrollment-performance-samples.mjs --cleanup
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { loadEnv } = require("../datasync/lib/env");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, "../.env.local"));

const SEED_ACTOR = "bao.vo@excelplannings.local";
const PERF_SAMPLE_MARKER = "[Perf sample enrollment]";
const PERF_SAMPLE_PREFIX = "https://perf.sample/enrollment/";
const DEFAULT_COUNT = 500;
const MAX_COUNT = 2_000;
const BATCH_SIZE = 200;

function argument(name) {
  const value = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
}

function parseCount() {
  const raw = argument("--count");
  const count = raw ? Number(raw) : DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new Error(`--count must be an integer from 1 to ${MAX_COUNT}.`);
  }
  return count;
}

function parseProgram() {
  const program = argument("--program") ?? "aca";
  if (!["aca", "medicare", "both"].includes(program)) {
    throw new Error('--program must be "aca", "medicare", or "both".');
  }
  return program;
}

function requireWriteConfirmation() {
  if (process.env.SEED_PERF_ALLOW !== "1") {
    throw new Error(
      "Refusing to write performance samples. Set SEED_PERF_ALLOW=1 after confirming this is a test database."
    );
  }
}

function programCounts(program, total) {
  if (program === "aca") return { aca: total, medicare: 0 };
  if (program === "medicare") return { aca: 0, medicare: total };
  const aca = Math.ceil(total / 2);
  return { aca, medicare: total - aca };
}

function normalizeEmail(email) {
  return email?.trim().toLowerCase() || null;
}

function isoForIndex(index, total) {
  const now = Date.now();
  const spread = Math.max(total, 1) * 60 * 60 * 1000;
  return new Date(now - spread + index * 60 * 60 * 1000).toISOString();
}

function dateForIndex(index) {
  const date = new Date(Date.now() + ((index % 21) - 10) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

async function loadEligibleAgents(supabase) {
  const [{ data: selected, error: selectedError }, { data: accounts, error: accountError }] =
    await Promise.all([
      supabase.from("task_agents").select("email").order("email", { ascending: true }),
      supabase.from("portal_account").select("email").eq("is_active", true),
    ]);
  if (selectedError) throw new Error(`Unable to read task_agents: ${selectedError.message}`);
  if (accountError) throw new Error(`Unable to read portal_account: ${accountError.message}`);

  const active = new Set(
    (accounts ?? []).map((row) => normalizeEmail(row.email)).filter(Boolean),
  );
  return [
    ...new Set(
      (selected ?? [])
        .map((row) => normalizeEmail(row.email))
        .filter((email) => email && active.has(email)),
    ),
  ];
}

async function loadOptions(supabase, program) {
  const { data: sets, error: setsError } = await supabase
    .from("enrollment_option_sets")
    .select("id,key")
    .eq("program", program);
  if (setsError) throw new Error(`Unable to read ${program} option sets: ${setsError.message}`);

  const setIds = (sets ?? []).map((row) => row.id);
  if (setIds.length === 0) throw new Error(`No option sets found for ${program}.`);

  const { data: options, error: optionsError } = await supabase
    .from("enrollment_options")
    .select("id,set_id,label,is_terminal,archived_at")
    .in("set_id", setIds)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("label", { ascending: true });
  if (optionsError) throw new Error(`Unable to read ${program} options: ${optionsError.message}`);

  const setById = new Map((sets ?? []).map((row) => [row.id, row.key]));
  const byKey = new Map();
  for (const option of options ?? []) {
    const key = setById.get(option.set_id);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, option);
  }
  const stageOptions = (options ?? []).filter(
    (option) => setById.get(option.set_id) === "stage",
  );
  if (stageOptions.length === 0) throw new Error(`No active stage options found for ${program}.`);
  return { byKey, stageOptions };
}

function buildRows({ program, count, options, agents, offset }) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const globalIndex = offset + index;
    const createdAt = isoForIndex(globalIndex, offset + count);
    const agentEmail = agents.length > 0 ? agents[globalIndex % agents.length] : null;
    const stage = options.stageOptions[globalIndex % options.stageOptions.length];
    const carrier = options.byKey.get("carrier");

    const row = {
      program,
      client_name: `${PERF_SAMPLE_MARKER} ${program.toUpperCase()} ${String(globalIndex + 1).padStart(4, "0")}`,
      description: "Synthetic performance-test enrollment. Contains no customer data.",
      fub_link: `${PERF_SAMPLE_PREFIX}${program}/${String(globalIndex + 1).padStart(4, "0")}`,
      due_date: dateForIndex(globalIndex),
      stage_id: stage.id,
      carrier_id: carrier?.id ?? null,
      agent_email: agentEmail,
      caller_email: null,
      responsible_enroll_email: agentEmail,
      created_by_email: SEED_ACTOR,
      created_at: createdAt,
      updated_by_email: SEED_ACTOR,
      updated_at: createdAt,
      stage_entered_at: createdAt,
      stage_entered_source: "live",
      last_activity_at: createdAt,
      last_activity_by_email: SEED_ACTOR,
      last_work_activity_at: createdAt,
      responsible_assigned_at: agentEmail ? createdAt : null,
      custom_values: {},
    };

    // Medicare intentionally leaves ACA-only fields null because of the
    // enrollment_records_medicare_fields_check constraint.
    if (program === "aca") {
      row.platform_id = options.byKey.get("platform")?.id ?? null;
      row.consent_id = options.byKey.get("consent")?.id ?? null;
      row.payment_status_id = options.byKey.get("payment_status")?.id ?? null;
      row.aca_status_id = options.byKey.get("aca_status")?.id ?? null;
      row.pcp_2025 = "Pending";
      row.pcp_2026 = "Pending";
    } else {
      row.pcp_2025 = "Pending";
    }
    rows.push(row);
  }
  return rows;
}

async function loadExisting(supabase) {
  const { data, error } = await supabase
    .from("enrollment_records")
    .select("id,fub_link,program")
    .like("client_name", `${PERF_SAMPLE_MARKER}%`)
    .like("fub_link", `${PERF_SAMPLE_PREFIX}%`)
    .order("fub_link", { ascending: true });
  if (error) throw new Error(`Unable to read existing performance samples: ${error.message}`);
  return data ?? [];
}

async function insertBatches(supabase, rows) {
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const { data, error } = await supabase
      .from("enrollment_records")
      .insert(batch)
      .select("id,program,fub_link,stage_id,agent_email,created_at");
    if (error) throw new Error(`Unable to insert performance samples: ${error.message}`);
    console.log(`Inserted ${Math.min(start + batch.length, rows.length)}/${rows.length}.`);
    await insertSideEffects(supabase, data ?? []);
  }
}

async function insertSideEffects(supabase, rows) {
  const activity = rows.map((row) => ({
    record_id: row.id,
    actor_email: SEED_ACTOR,
    type: "created",
    meta: { source: "performance_sample_seed", program: row.program },
    created_at: row.created_at,
  }));
  const cycles = rows
    .filter((row) => row.stage_id)
    .map((row) => ({
      record_id: row.id,
      stage_id: row.stage_id,
      agent_email: row.agent_email,
      program: row.program,
      kind: "dwell",
      started_at: row.created_at,
      started_by_email: SEED_ACTOR,
      source: "live",
      responsible_start_email: row.agent_email,
    }));
  const [activityResult, cyclesResult] = await Promise.all([
    supabase.from("enrollment_activity").insert(activity),
    supabase.from("enrollment_stage_cycles").insert(cycles),
  ]);
  if (activityResult.error) {
    throw new Error(`Samples inserted but activity side effects failed: ${activityResult.error.message}`);
  }
  if (cyclesResult.error) {
    throw new Error(`Samples inserted but stage side effects failed: ${cyclesResult.error.message}`);
  }
}

async function cleanup(supabase) {
  requireWriteConfirmation();
  const existing = await loadExisting(supabase);
  console.log(`Target database: ${process.env.SUPABASE_URL}`);
  console.log(`Performance samples found: ${existing.length}`);
  if (existing.length === 0) return;

  const ids = existing.map((row) => row.id);
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE);
    const { error } = await supabase.from("enrollment_records").delete().in("id", batch);
    if (error) throw new Error(`Unable to clean performance samples: ${error.message}`);
  }
  console.log(`Deleted ${ids.length} isolated performance sample(s).`);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (process.argv.includes("--cleanup")) {
    await cleanup(supabase);
    return;
  }

  const count = parseCount();
  const program = parseProgram();
  const counts = programCounts(program, count);
  const existing = await loadExisting(supabase);
  const agents = await loadEligibleAgents(supabase);
  const options = {};
  if (counts.aca > 0) options.aca = await loadOptions(supabase, "aca");
  if (counts.medicare > 0) options.medicare = await loadOptions(supabase, "medicare");

  const rows = [
    ...buildRows({ program: "aca", count: counts.aca, options: options.aca, agents, offset: 0 }),
    ...buildRows({
      program: "medicare",
      count: counts.medicare,
      options: options.medicare,
      agents,
      offset: counts.aca,
    }),
  ];
  const existingLinks = new Set(existing.map((row) => row.fub_link));
  const inserts = rows.filter((row) => !existingLinks.has(row.fub_link));

  console.log(`Target database: ${supabaseUrl}`);
  console.log(`Requested: ${count} total (${counts.aca} ACA, ${counts.medicare} Medicare).`);
  console.log(`Existing isolated samples: ${existing.length}; new rows: ${inserts.length}.`);
  console.log(`Eligible agents used for distribution: ${agents.length}.`);
  if (process.argv.includes("--dry-run")) {
    console.log("--dry-run: nothing written.");
    return;
  }
  requireWriteConfirmation();
  if (inserts.length === 0) {
    console.log("All requested performance samples already exist.");
    return;
  }
  await insertBatches(supabase, inserts);
  console.log(`Inserted ${inserts.length} isolated enrollment performance sample(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

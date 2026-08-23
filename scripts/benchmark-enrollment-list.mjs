#!/usr/bin/env node

/**
 * Measures the two list costs relevant to HIGH-03/HIGH-04:
 * 1. the enrollment_records list query and its exact count;
 * 2. the child-row hydration used to calculate comment/attachment counts.
 *
 * This uses the service role against the configured test database. It does not
 * write data. Use --viewer=email to measure the agent-scoped OR filter; without
 * it the first eligible selected agent is used.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { loadEnv } = require("../datasync/lib/env");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, "../.env.local"));

const LIST_COLUMNS =
  "id,display_number,program,client_name,due_date,stage_id,carrier_id,agent_email,caller_email,responsible_enroll_email,created_by_email,created_at,updated_at,archived_at";
const PERF_SAMPLE_PREFIX = "https://perf.sample/enrollment/";
const PERF_MARKER = "[Perf sample enrollment]";
const CHILD_ID_CHUNK_SIZE = 50;

function argument(name) {
  const value = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
}

function parseProgram() {
  const value = argument("--program") ?? "aca";
  if (!value || !["aca", "medicare"].includes(value)) {
    throw new Error('--program must be "aca" or "medicare".');
  }
  return value;
}

function parseIterations() {
  const value = Number(argument("--iterations") ?? 5);
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error("--iterations must be an integer from 1 to 20.");
  }
  return value;
}

function normalizeEmail(email) {
  return email?.trim().toLowerCase() || "";
}

function quoteFilterValue(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function loadAgentScope(supabase, requestedViewer) {
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
  const selectedAgents = (selected ?? [])
    .map((row) => normalizeEmail(row.email))
    .filter((email) => email && active.has(email));
  const viewer = normalizeEmail(requestedViewer) || selectedAgents[0] || "";
  if (!viewer) throw new Error("No active selected agent found; pass --viewer=email.");

  const { data: assistantRows, error: assistantError } = await supabase
    .from("agent_members")
    .select("agent_email")
    .eq("cs_email", viewer)
    .eq("is_assistant", true);
  if (assistantError) throw new Error(`Unable to read agent_members: ${assistantError.message}`);

  const assistantAgents = (assistantRows ?? [])
    .map((row) => normalizeEmail(row.agent_email))
    .filter(Boolean);
  const isAgent = selectedAgents.includes(viewer);
  const seesAll = !isAgent && assistantAgents.length === 0;
  const agentEmails = [
    ...new Set([...(isAgent ? [viewer] : []), ...assistantAgents]),
  ];
  return { viewer, isAgent, seesAll, agentEmails };
}

function buildScopedFilters(scope) {
  if (scope.seesAll) return [];
  const filters = [];
  if (scope.agentEmails.length > 0) {
    filters.push(
      `agent_email.in.(${scope.agentEmails.map(quoteFilterValue).join(",")})`,
    );
  }
  const viewer = quoteFilterValue(scope.viewer);
  filters.push(
    `created_by_email.eq.${viewer}`,
    `caller_email.eq.${viewer}`,
    `responsible_enroll_email.eq.${viewer}`,
  );
  return filters;
}

async function runListQuery(supabase, program, filters) {
  let query = supabase
    .from("enrollment_records")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("program", program)
    .is("archived_at", null);
  if (filters.length > 0) query = query.or(filters.join(","));
  return query.order("updated_at", { ascending: false });
}

async function runHydrationQueries(supabase, ids) {
  if (ids.length === 0) return { comments: 0, attachments: 0 };
  const chunks = [];
  for (let start = 0; start < ids.length; start += CHILD_ID_CHUNK_SIZE) {
    chunks.push(ids.slice(start, start + CHILD_ID_CHUNK_SIZE));
  }
  const [commentResults, attachmentResults] = await Promise.all([
    Promise.all(
      chunks.map((chunk) =>
        supabase
          .from("enrollment_comments")
          .select("record_id,body")
          .in("record_id", chunk)
          .is("deleted_at", null),
      ),
    ),
    Promise.all(
      chunks.map((chunk) =>
        supabase.from("enrollment_attachments").select("record_id").in("record_id", chunk),
      ),
    ),
  ]);
  const commentError = commentResults.find((result) => result.error)?.error;
  if (commentError) throw new Error(`Comment hydration failed: ${commentError.message}`);
  const attachmentError = attachmentResults.find((result) => result.error)?.error;
  if (attachmentError) throw new Error(`Attachment hydration failed: ${attachmentError.message}`);
  return {
    comments: commentResults.reduce((total, result) => total + (result.data?.length ?? 0), 0),
    attachments: attachmentResults.reduce((total, result) => total + (result.data?.length ?? 0), 0),
  };
}

function summarize(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  return {
    min: Number(sorted[0].toFixed(1)),
    p50: Number(percentile(0.5).toFixed(1)),
    p95: Number(percentile(0.95).toFixed(1)),
    max: Number(sorted[sorted.length - 1].toFixed(1)),
  };
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
  const program = parseProgram();
  const iterations = parseIterations();
  const skipHydration = process.argv.includes("--skip-hydration");
  const allQueue = process.argv.includes("--all");
  const scope = allQueue
    ? { viewer: "<all queue>", isAgent: false, seesAll: true, agentEmails: [] }
    : await loadAgentScope(supabase, argument("--viewer"));
  const filters = buildScopedFilters(scope);

  console.log(`Target database: ${supabaseUrl}`);
  console.log(
    `Program: ${program}; iterations: ${iterations}; queue=${allQueue ? "all" : "scoped"}; ` +
      `hydration=${skipHydration ? "skipped" : "included"}`,
  );
  console.log(
    `Viewer: ${scope.viewer}; agent=${scope.isAgent}; seesAll=${scope.seesAll}; ` +
      `agent filter values=${scope.agentEmails.length}; filter bytes=${filters.join(",").length}`,
  );
  console.log(`Sample marker filter: ${PERF_MARKER} / ${PERF_SAMPLE_PREFIX}`);

  const listSamples = [];
  const hydrationSamples = [];
  let lastRows = [];
  let lastCount = null;
  let hydrationResult = { comments: 0, attachments: 0 };

  for (let index = 0; index < iterations; index += 1) {
    const listStart = performance.now();
    const { data, error, count } = await runListQuery(supabase, program, filters);
    const listMs = performance.now() - listStart;
    if (error) throw new Error(`Enrollment list query failed: ${error.message}`);
    listSamples.push(listMs);
    lastRows = data ?? [];
    lastCount = count;

    if (!skipHydration) {
      const ids = lastRows.map((row) => row.id).filter(Boolean);
      const hydrationStart = performance.now();
      hydrationResult = await runHydrationQueries(supabase, ids);
      hydrationSamples.push(performance.now() - hydrationStart);
    }
  }

  console.log(JSON.stringify({
    rowsLoaded: lastRows.length,
    exactCount: lastCount,
    truncated: typeof lastCount === "number" && lastCount > lastRows.length,
    listMs: summarize(listSamples),
    hydrationMs: summarize(hydrationSamples),
    hydratedChildRows: hydrationResult,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

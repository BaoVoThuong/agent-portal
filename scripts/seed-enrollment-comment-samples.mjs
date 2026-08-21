#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { loadEnv } = require("../datasync/lib/env");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, "../.env.local"));

const SAMPLE_MARKER = "[Perf sample comment]";
const SEED_ACTOR = "bao.vo@excelplannings.local";
const DEFAULT_COUNT = 120;
const MAX_COUNT = 1_000;
const SAMPLE_PREFIXES = {
  aca: [
    "https://app.followupboss.com/2/people/view/sample-enrollment-",
    "https://sample.qa/enrollment-aca/",
  ],
  medicare: [
    "https://app.followupboss.com/2/people/view/sample-medicare-",
    "https://sample.qa/enrollment-medicare/",
  ],
};
const AUTHORS = [
  SEED_ACTOR,
  "khanh.chau.sample@excelplannings.local",
  "dung.ha.sample@excelplannings.local",
];

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
  if (program !== "aca" && program !== "medicare" && program !== "both") {
    throw new Error('--program must be "aca", "medicare", or "both".');
  }
  return program;
}

function isSampleLink(link, program) {
  return SAMPLE_PREFIXES[program].some((prefix) => link?.startsWith(prefix));
}

function commentBody(recordId, index, count) {
  const base = `${SAMPLE_MARKER} record=${recordId} index=${index}/${count}`;
  if (index % 10 !== 0) {
    return `${base} — synthetic comment used to measure Enrollment comment pagination.`;
  }
  return `${base} — long synthetic comment used to exercise wrapping, scroll, and refresh behavior. ${
    "This is performance-test text and contains no customer data. ".repeat(28)
  }`;
}

function commentCreatedAt(record, index, count) {
  const recordTime = Date.parse(record.created_at ?? "");
  const base = Number.isFinite(recordTime)
    ? recordTime
    : Date.now() - count * 60_000;
  return new Date(base + index * 60_000).toISOString();
}

async function loadSampleRecords(supabase, program) {
  const programs = program === "both" ? ["aca", "medicare"] : [program];
  const results = await Promise.all(
    programs.flatMap((currentProgram) =>
      SAMPLE_PREFIXES[currentProgram].map((prefix) =>
        supabase
          .from("enrollment_records")
          .select("id,program,client_name,fub_link,created_at")
          .eq("program", currentProgram)
          .like("fub_link", `${prefix}%`),
      ),
    ),
  );
  const error = results.find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to read sample enrollment records: ${error.message}`);

  const byId = new Map();
  for (const result of results) {
    for (const row of result.data ?? []) {
      if (isSampleLink(row.fub_link, row.program)) byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.fub_link.localeCompare(b.fub_link));
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
  const count = parseCount();
  const all = process.argv.includes("--all");
  const requestedRecordId = argument("--record");
  const samples = await loadSampleRecords(supabase, program);
  if (samples.length === 0) {
    throw new Error("No matching enrollment sample records found. Run npm run seed:enrollment first.");
  }

  const targets = requestedRecordId
    ? samples.filter((record) => record.id === requestedRecordId)
    : all
      ? samples
      : samples.slice(0, program === "both" ? 2 : 1);
  if (targets.length === 0) {
    throw new Error("--record must point to a matching sample enrollment record.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("enrollment_comments")
    .select("record_id,body")
    .in("record_id", targets.map((record) => record.id))
    .like("body", `${SAMPLE_MARKER}%`);
  if (existingError) {
    throw new Error(`Unable to read existing performance comments: ${existingError.message}`);
  }
  const existingBodies = new Set((existing ?? []).map((row) => `${row.record_id}:${row.body}`));
  const rows = [];
  for (const record of targets) {
    for (let index = 1; index <= count; index += 1) {
      const body = commentBody(record.id, index, count);
      if (existingBodies.has(`${record.id}:${body}`)) continue;
      rows.push({
        record_id: record.id,
        parent_id: null,
        author_email: AUTHORS[(index - 1) % AUTHORS.length],
        body,
        created_at: commentCreatedAt(record, index, count),
        updated_at: commentCreatedAt(record, index, count),
      });
    }
  }

  console.log(`Target database: ${supabaseUrl}`);
  console.log(`Targets: ${targets.length} sample record(s), ${count} comments requested per record.`);
  for (const record of targets) {
    const missing = rows.filter((row) => row.record_id === record.id).length;
    console.log(`  ${record.program} ${record.id} ${record.client_name}: ${missing} new comment(s)`);
  }
  if (process.argv.includes("--dry-run")) {
    console.log("--dry-run: nothing written.");
    return;
  }
  if (rows.length === 0) {
    console.log("All requested performance comments already exist.");
    return;
  }

  for (let start = 0; start < rows.length; start += 200) {
    const batch = rows.slice(start, start + 200);
    const { error } = await supabase.from("enrollment_comments").insert(batch);
    if (error) throw new Error(`Unable to insert performance comments: ${error.message}`);
    console.log(`Inserted ${Math.min(start + batch.length, rows.length)}/${rows.length} comment(s).`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

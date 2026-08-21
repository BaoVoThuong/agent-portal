#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { loadEnv } = require("../datasync/lib/env");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, "../.env.local"));

const COMMENT_COLUMNS =
  "id,record_id,parent_id,author_email,body,created_at,updated_at,deleted_at";
const DEFAULT_SAMPLE_RECORD_ID = "a804d1ee-720f-401b-b5fe-2eb0d7c31fca";
const ITERATIONS = 7;

function argument(name, fallback) {
  const value = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : fallback;
}

async function loadCommentPage(supabase, recordId, limit) {
  const { data: comments, error: commentsError } = await supabase
    .from("enrollment_comments")
    .select(COMMENT_COLUMNS)
    .eq("record_id", recordId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (commentsError) throw commentsError;

  const rows = comments ?? [];
  const commentIds = rows.slice(0, limit).map((row) => row.id);
  const emails = [...new Set(rows.map((row) => row.author_email).filter(Boolean))];
  const [names, attachments] = await Promise.all([
    supabase.from("portal_account").select("email,name").in("email", emails),
    commentIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("enrollment_attachments")
          .select("id,comment_id,file_name,mime_type,size_bytes,storage_path,created_at")
          .in("comment_id", commentIds)
          .not("comment_id", "is", null)
          .order("created_at", { ascending: true }),
  ]);
  if (names.error) throw names.error;
  if (attachments.error) throw attachments.error;
  return {
    comments: rows.slice(0, limit),
    hasMore: rows.length > limit,
    names: names.data?.length ?? 0,
    attachments: attachments.data?.length ?? 0,
  };
}

async function loadDetailCore(supabase, recordId) {
  const [comments, activity, attachments] = await Promise.all([
    loadCommentPage(supabase, recordId, 50),
    supabase
      .from("enrollment_activity")
      .select("id,actor_email,type,meta,created_at")
      .eq("record_id", recordId)
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("enrollment_attachments")
      .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
      .eq("record_id", recordId)
      .is("comment_id", null)
      .order("created_at", { ascending: true }),
  ]);
  if (activity.error) throw activity.error;
  if (attachments.error) throw attachments.error;
  return {
    comments: comments.comments.length,
    hasMore: comments.hasMore,
    activity: activity.data?.length ?? 0,
    attachments: attachments.data?.length ?? 0,
  };
}

async function measure(label, operation) {
  const samples = [];
  let result;
  for (let index = 0; index < ITERATIONS; index += 1) {
    const started = performance.now();
    result = await operation();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const percentile = (value) => value[Math.min(value.length - 1, Math.floor(value.length * 0.95))];
  return {
    label,
    result,
    minMs: samples[0],
    p50Ms: samples[Math.floor(samples.length / 2)],
    p95Ms: percentile(samples),
    maxMs: samples[samples.length - 1],
  };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const recordId = argument("--record", DEFAULT_SAMPLE_RECORD_ID);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: record, error: recordError } = await supabase
    .from("enrollment_records")
    .select("id,program,client_name,fub_link")
    .eq("id", recordId)
    .maybeSingle();
  if (recordError) throw recordError;
  if (!record) throw new Error(`Enrollment record ${recordId} was not found.`);

  const page = await loadCommentPage(supabase, recordId, 50);
  console.log(`Target: ${record.program} ${record.client_name} (${record.id})`);
  console.log(`Comment page: ${page.comments.length} rows, hasMore=${page.hasMore}, names=${page.names}, attachments=${page.attachments}`);
  console.log(`Iterations: ${ITERATIONS} (read-only Supabase queries; excludes browser render/reaction fetch)`);

  const results = [
    await measure("comment page + names + comment attachments", () => loadCommentPage(supabase, recordId, 50)),
    await measure("full detail critical path (comments/activity/record attachments parallel)", () => loadDetailCore(supabase, recordId)),
    await measure("comment page after load older (120 rows)", () => loadCommentPage(supabase, recordId, 120)),
  ];
  for (const result of results) {
    console.log(
      `${result.label}: min=${result.minMs.toFixed(1)}ms p50=${result.p50Ms.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms max=${result.maxMs.toFixed(1)}ms`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

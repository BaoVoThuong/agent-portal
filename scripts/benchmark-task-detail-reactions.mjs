#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { loadEnv } = require("../datasync/lib/env");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, "../.env.local"));

const COMMENT_LIMIT = 50;
const DEFAULT_ITERATIONS = 7;

function argument(name, fallback = null) {
  const value = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : fallback;
}

function assertNoError(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

async function loadCommentPage(supabase, taskId) {
  const commentsResult = await supabase
    .from("task_comments")
    .select("id,author_email,parent_id")
    .eq("task_id", taskId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(COMMENT_LIMIT + 1);
  assertNoError(commentsResult, "comments");

  const comments = commentsResult.data ?? [];
  const commentIds = comments.slice(0, COMMENT_LIMIT).map((row) => row.id);
  const emails = [...new Set(comments.map((row) => row.author_email).filter(Boolean))];
  const [namesResult, attachmentsResult] = await Promise.all([
    emails.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("portal_account").select("email,name").in("email", emails),
    commentIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("task_attachments")
          .select("id,comment_id,file_name,mime_type,size_bytes,storage_path,created_at")
          .in("comment_id", commentIds)
          .not("comment_id", "is", null)
          .is("deleted_at", null)
          .order("created_at", { ascending: true }),
  ]);
  assertNoError(namesResult, "comment names");
  assertNoError(attachmentsResult, "comment attachments");

  return {
    comments: Math.min(comments.length, COMMENT_LIMIT),
    hasMore: comments.length > COMMENT_LIMIT,
    names: namesResult.data?.length ?? 0,
    attachments: attachmentsResult.data?.length ?? 0,
  };
}

async function loadDetailCore(supabase, taskId) {
  const [commentsResult, activityResult, taskAttachmentsResult] = await Promise.all([
    loadCommentPage(supabase, taskId),
    supabase
      .from("task_activity")
      .select("id,actor_email,type,meta,created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("task_attachments")
      .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
      .eq("task_id", taskId)
      .is("comment_id", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
  ]);
  assertNoError(activityResult, "activity");
  assertNoError(taskAttachmentsResult, "task attachments");
  return {
    ...commentsResult,
    activity: activityResult.data?.length ?? 0,
    taskAttachments: taskAttachmentsResult.data?.length ?? 0,
  };
}

async function loadTaskScope(supabase, taskId) {
  const result = await supabase
    .from("tasks")
    .select("id,assignee_email,agent_email")
    .eq("id", taskId)
    .maybeSingle();
  assertNoError(result, "task scope");
  return Boolean(result.data);
}

async function loadReactions(supabase, taskId) {
  const result = await supabase.rpc("task_comment_reactions_for_task", {
    p_task_id: taskId,
  });
  assertNoError(result, "reactions");
  return result.data?.length ?? 0;
}

async function measure(operation) {
  const started = performance.now();
  const result = await operation();
  return { duration: performance.now() - started, result };
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function printResult(label, samples) {
  console.log(
    `${label}: min=${Math.min(...samples).toFixed(1)}ms ` +
      `p50=${percentile(samples, 0.5).toFixed(1)}ms ` +
      `p95=${percentile(samples, 0.95).toFixed(1)}ms ` +
      `max=${Math.max(...samples).toFixed(1)}ms`,
  );
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const rawIterations = Number(argument("--iterations", String(DEFAULT_ITERATIONS)));
  if (!Number.isInteger(rawIterations) || rawIterations < 3 || rawIterations > 30) {
    throw new Error("--iterations must be an integer from 3 to 30.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let taskId = argument("--task");
  if (!taskId) {
    const latest = await supabase
      .from("tasks")
      .select("id,title")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    assertNoError(latest, "latest task");
    if (!latest.data) throw new Error("No active task found. Pass --task=<uuid>.");
    taskId = latest.data.id;
    console.log(`Target selected from latest active task: ${latest.data.title ?? taskId}`);
  }

  const target = await supabase.from("tasks").select("id,title").eq("id", taskId).maybeSingle();
  assertNoError(target, "target task");
  if (!target.data) throw new Error(`Task ${taskId} was not found.`);

  // Warm the connection and database plan before collecting samples.
  await Promise.all([
    loadTaskScope(supabase, taskId),
    loadDetailCore(supabase, taskId),
    loadReactions(supabase, taskId),
  ]);

  const split = [];
  const merged = [];
  for (let index = 0; index < rawIterations; index += 1) {
    const runSplit = async () => {
      const detail = await loadDetailCore(supabase, taskId);
      const reactions = await loadReactions(supabase, taskId);
      return { detail, reactions };
    };
    const runMerged = async () => {
      const [detail, reactions] = await Promise.all([
        loadDetailCore(supabase, taskId),
        loadReactions(supabase, taskId),
      ]);
      return { detail, reactions };
    };
    const first = index % 2 === 0 ? runSplit : runMerged;
    const second = index % 2 === 0 ? runMerged : runSplit;
    const firstResult = await measure(first);
    const secondResult = await measure(second);
    (index % 2 === 0 ? split : merged).push(firstResult.duration);
    (index % 2 === 0 ? merged : split).push(secondResult.duration);
  }

  console.log(`Task: ${target.data.title ?? taskId} (${taskId})`);
  console.log(`Iterations: ${rawIterations} (read-only Supabase data path)`);
  console.log("Note: excludes auth, Next/proxy overhead, signed URLs, and browser paint.");
  const taskScopeSamples = [];
  for (let index = 0; index < rawIterations; index += 1) {
    taskScopeSamples.push((await measure(() => loadTaskScope(supabase, taskId))).duration);
  }
  printResult("CS scope task lookup", taskScopeSamples);
  printResult("split: detail then reactions", split);
  printResult("merged: detail + reactions in parallel", merged);
  console.log(`merged delta p50: ${(percentile(merged, 0.5) - percentile(split, 0.5)).toFixed(1)}ms`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

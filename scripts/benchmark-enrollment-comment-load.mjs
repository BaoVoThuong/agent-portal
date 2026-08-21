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
const ENROLLMENT_RECORD_COLUMNS =
  "id,display_number,program,client_name,description,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,custom_values,agent_email,caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,created_at,updated_by_email,updated_at,archived_at,stage_entered_at,stage_entered_source,last_activity_at,last_activity_by_email";
const DEFAULT_SAMPLE_RECORD_ID = "a804d1ee-720f-401b-b5fe-2eb0d7c31fca";
const DEFAULT_ITERATIONS = 7;

function argument(name, fallback) {
  const value = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : fallback;
}

async function findScopeActor(supabase, configuredActor) {
  if (configuredActor) return configuredActor;
  const result = await supabase
    .from("agent_members")
    .select("cs_email")
    .eq("is_assistant", true)
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data?.cs_email ?? null;
}

async function loadScopeMembership(supabase, actorEmail) {
  const [selectedAgents, assistantAgents] = await Promise.all([
    supabase.from("task_agents").select("email"),
    supabase
      .from("agent_members")
      .select("agent_email")
      .eq("cs_email", actorEmail)
      .eq("is_assistant", true),
  ]);
  if (selectedAgents.error) throw selectedAgents.error;
  if (assistantAgents.error) throw assistantAgents.error;

  const isAgent = (selectedAgents.data ?? []).some(
    (row) => String(row.email).trim().toLowerCase() === actorEmail.trim().toLowerCase(),
  );
  const isAssistant = (assistantAgents.data ?? []).length > 0;
  if (!isAgent && !isAssistant) {
    return {
      isAgent,
      isAssistant,
      firstPassRows: assistantAgents.data?.length ?? 0,
      duplicatePassRows: 0,
    };
  }

  // This is the second, currently duplicated fetchAgentsForCs() query.
  const duplicate = await supabase
    .from("agent_members")
    .select("agent_email")
    .eq("cs_email", actorEmail)
    .eq("is_assistant", true);
  if (duplicate.error) throw duplicate.error;
  return {
    isAgent,
    isAssistant,
    firstPassRows: assistantAgents.data?.length ?? 0,
    duplicatePassRows: duplicate.data?.length ?? 0,
  };
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

async function loadDetailCore(supabase, recordId, includeActivity = true) {
  const [comments, activity, attachments] = await Promise.all([
    loadCommentPage(supabase, recordId, 50),
    includeActivity
      ? supabase
          .from("enrollment_activity")
          .select("id,actor_email,type,meta,created_at")
          .eq("record_id", recordId)
          .order("created_at", { ascending: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
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

async function loadScopeRecordRow(supabase, recordId) {
  const recordResult = await supabase
    .from("enrollment_records")
    .select(ENROLLMENT_RECORD_COLUMNS)
    .eq("id", recordId)
    .is("archived_at", null)
    .maybeSingle();
  if (recordResult.error) throw recordResult.error;
  return Boolean(recordResult.data);
}

async function loadScopeCounts(supabase, recordId) {
  const [commentsCount, attachmentsCount] = await Promise.all([
    supabase
      .from("enrollment_comments")
      .select("id", { count: "exact", head: true })
      .eq("record_id", recordId)
      .is("deleted_at", null),
    supabase
      .from("enrollment_attachments")
      .select("id", { count: "exact", head: true })
      .eq("record_id", recordId),
  ]);
  if (commentsCount.error) throw commentsCount.error;
  if (attachmentsCount.error) throw attachmentsCount.error;
  return {
    commentCount: commentsCount.count ?? 0,
    attachmentCount: attachmentsCount.count ?? 0,
  };
}

async function loadScopeRecord(supabase, recordId) {
  const record = await loadScopeRecordRow(supabase, recordId);
  const counts = await loadScopeCounts(supabase, recordId);
  return { record, ...counts };
}

async function loadReactions(supabase, recordId) {
  const result = await supabase.rpc("enrollment_comment_reactions_for_record", {
    p_record_id: recordId,
  });
  if (result.error) throw result.error;
  return result.data?.length ?? 0;
}

async function measure(label, operation, iterations) {
  const samples = [];
  let result;
  for (let index = 0; index < iterations; index += 1) {
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
  const rawIterations = Number(argument("--iterations", String(DEFAULT_ITERATIONS)));
  if (!Number.isInteger(rawIterations) || rawIterations < 3 || rawIterations > 30) {
    throw new Error("--iterations must be an integer from 3 to 30.");
  }
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
  console.log(`Iterations: ${rawIterations} (read-only Supabase queries; excludes browser render/reaction fetch)`);

  const scopeActor = await findScopeActor(supabase, argument("--actor", null));
  if (scopeActor) {
    const membership = await measure(
      "enrollment worker membership scope",
      () => loadScopeMembership(supabase, scopeActor),
      rawIterations,
    );
    console.log(
      `worker membership scope: min=${membership.minMs.toFixed(1)}ms p50=${membership.p50Ms.toFixed(1)}ms p95=${membership.p95Ms.toFixed(1)}ms max=${membership.maxMs.toFixed(1)}ms ` +
        `(first=${membership.result.firstPassRows}, duplicated=${membership.result.duplicatePassRows})`,
    );
  }

  const results = [
    await measure("enrollment scope full record row", () => loadScopeRecordRow(supabase, recordId), rawIterations),
    await measure("enrollment scope comments/attachments counts", () => loadScopeCounts(supabase, recordId), rawIterations),
    await measure("enrollment scope record + comments/attachments counts", () => loadScopeRecord(supabase, recordId), rawIterations),
    await measure("comment page + names + comment attachments", () => loadCommentPage(supabase, recordId, 50), rawIterations),
    await measure("full detail critical path (comments/activity/record attachments parallel)", () => loadDetailCore(supabase, recordId), rawIterations),
    await measure("detail critical path without activity", () => loadDetailCore(supabase, recordId, false), rawIterations),
    await measure("split: enrollment detail then reactions", async () => {
      const detail = await loadDetailCore(supabase, recordId);
      const reactions = await loadReactions(supabase, recordId);
      return { ...detail, reactions };
    }, rawIterations),
    await measure("merged: enrollment detail + reactions in parallel", async () => {
      const [detail, reactions] = await Promise.all([
        loadDetailCore(supabase, recordId),
        loadReactions(supabase, recordId),
      ]);
      return { ...detail, reactions };
    }, rawIterations),
    await measure("comment page after load older (120 rows)", () => loadCommentPage(supabase, recordId, 120), rawIterations),
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

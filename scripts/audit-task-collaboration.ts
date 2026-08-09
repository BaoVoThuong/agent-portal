// Read-only reconciliation report for task comments, attachments, activity,
// and overdue invariants. This script never repairs or deletes data.
import { getSupabaseAdmin } from "@/lib/supabase";

type Section = { name: string; rows: unknown[] };

async function rpcRows(db: ReturnType<typeof getSupabaseAdmin>, name: string): Promise<unknown[]> {
  const { data, error } = await db.rpc(name);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data ?? [];
}

async function run(): Promise<Section[]> {
  const db = getSupabaseAdmin();
  const sections: Section[] = [];

  sections.push({ name: "comment_activity_gaps", rows: await rpcRows(db, "audit_comment_activity_gaps") });

  const { data: attachments, error: attachmentError } = await db
    .from("task_attachments")
    .select("id,task_id,storage_path");
  if (attachmentError) throw new Error(`task_attachments: ${attachmentError.message}`);
  const broken: unknown[] = [];
  for (const row of (attachments ?? []) as { id: string; task_id: string; storage_path: string }[]) {
    const { error } = await db.storage.from("task-files").createSignedUrl(row.storage_path, 60);
    if (error) broken.push({ id: row.id, task_id: row.task_id, reason: error.message });
  }
  sections.push({ name: "unsignable_attachments", rows: broken });

  sections.push({ name: "last_activity_actor_mismatch", rows: await rpcRows(db, "audit_last_activity_mismatch") });
  sections.push({ name: "overdue_gaps", rows: await rpcRows(db, "audit_overdue_gaps") });
  sections.push({ name: "duplicate_comment_candidates", rows: await rpcRows(db, "audit_duplicate_comments") });
  sections.push({ name: "cross_task_comment_links", rows: await rpcRows(db, "audit_cross_task_comment_links") });
  return sections;
}

run()
  .then((sections) => {
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(sections, null, 2));
      return;
    }
    for (const section of sections) {
      console.log(`\n=== ${section.name} (${section.rows.length}) ===`);
      for (const row of section.rows) console.log(JSON.stringify(row));
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

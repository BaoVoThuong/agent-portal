import { hasGrant } from "@/lib/authz/grants";
import { grantsForAccess } from "@/lib/authz/principal";
import { canAccessEnrollment, enrollmentActorFromGrants } from "@/lib/enrollment/policy";
import { enrollmentScopeFor, isRecordInScope } from "@/lib/enrollment/scope";
import { getUserAccessByEmails } from "@/lib/rbac/access";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canViewTask, taskActorFromGrants } from "@/lib/tasks/access";
import { isMissingTaskParticipantsError } from "@/lib/tasks/participants";

/**
 * "AI NHẬN ĐƯỢC" (Phase F, D17): một người chỉ nhận — và chỉ đọc lại — thông báo
 * về bản ghi họ XEM ĐƯỢC ngay lúc đó, theo đúng luật của trang (grant + quan hệ).
 *
 * Tính THEO LÔ cho nhiều cặp (bản ghi, người): mỗi loại dữ liệu một truy vấn,
 * không phải một chuỗi truy vấn cho mỗi người nhận (review Phase A, P2-02).
 *
 * Lỗi đọc thì NÉM — người gọi quyết định fail-closed. Không bao giờ "không đọc
 * được thì cho qua".
 */

export type AudiencePair = { entityId: string; email: string };

export function audienceKey(entityId: string, email: string): string {
  return `${entityId}|${normalize(email)}`;
}

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * `.in()` đi trong URL: ~39 byte mỗi UUID, proxy thường chặn ở 8–16 KB. Cron ghi
 * thông báo cho hàng trăm task một lượt, nên đọc theo lô.
 */
const IN_CHUNK = 100;

async function selectIn<T>(
  table: string,
  columns: string,
  column: string,
  values: readonly string[],
  optional?: (error: { code?: string; message?: string }) => boolean
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const { data, error } = await getSupabaseAdmin()
      .from(table)
      .select(columns)
      .in(column, values.slice(i, i + IN_CHUNK));
    if (error) {
      if (optional?.(error)) return [];
      throw new Error(error.message);
    }
    out.push(...((data ?? []) as unknown as T[]));
  }
  return out;
}

type Viewer = {
  grants: string[];
  isAgent: boolean;
  assistantAgents: string[];
};

/** Grant + quan hệ tổ chức của từng người, cho cả lô. Account khoá → không grant. */
async function loadViewers(emails: readonly string[]): Promise<Map<string, Viewer>> {
  const unique = [...new Set(emails.map(normalize).filter(Boolean))];
  const viewers = new Map<string, Viewer>();
  if (unique.length === 0) return viewers;

  const supabase = getSupabaseAdmin();
  const [accessByEmail, rosterRes, assistantRes] = await Promise.all([
    getUserAccessByEmails(unique),
    supabase.from("task_agents").select("email"),
    supabase
      .from("agent_members")
      .select("agent_email,cs_email")
      .eq("is_assistant", true)
      .in("cs_email", unique),
  ]);
  if (rosterRes.error) throw new Error(rosterRes.error.message);
  if (assistantRes.error) throw new Error(assistantRes.error.message);

  const roster = new Set(
    ((rosterRes.data ?? []) as { email: string }[]).map((row) => normalize(row.email))
  );
  const assistantsByCs = new Map<string, string[]>();
  for (const row of (assistantRes.data ?? []) as { agent_email: string; cs_email: string }[]) {
    const cs = normalize(row.cs_email);
    assistantsByCs.set(cs, [...(assistantsByCs.get(cs) ?? []), normalize(row.agent_email)]);
  }

  await Promise.all(
    unique.map(async (email) => {
      const access = accessByEmail.get(email);
      if (access?.lookupFailed) throw new Error(`access lookup failed for a recipient`);
      viewers.set(email, {
        grants: access ? await grantsForAccess(access) : [],
        isAgent: roster.has(email),
        assistantAgents: [...new Set(assistantsByCs.get(email) ?? [])],
      });
    })
  );
  return viewers;
}

type TaskMeta = {
  id: string;
  agent_email: string | null;
  assignee_email: string | null;
  reporter_email: string | null;
};

/** Các cặp (task, người) mà người đó XEM ĐƯỢC task — theo `canViewTask`. */
export async function taskViewersAmong(pairs: readonly AudiencePair[]): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (pairs.length === 0) return allowed;
  const taskIds = [...new Set(pairs.map((pair) => pair.entityId))];

  const [viewers, metaRows, assigneeRows, participantRows] = await Promise.all([
    loadViewers(pairs.map((pair) => pair.email)),
    selectIn<TaskMeta>("tasks", "id,agent_email,assignee_email,reporter_email", "id", taskIds),
    selectIn<{ task_id: string; email: string }>("task_assignees", "task_id,email", "task_id", taskIds),
    selectIn<{ task_id: string; email: string }>(
      "task_participants",
      "task_id,email",
      "task_id",
      taskIds,
      isMissingTaskParticipantsError
    ),
  ]);

  const metaById = new Map(metaRows.map((row) => [row.id, row]));
  const groupByTask = (rows: { task_id: string; email: string }[] | null) => {
    const out = new Map<string, Set<string>>();
    for (const row of rows ?? []) {
      const set = out.get(row.task_id) ?? new Set<string>();
      set.add(normalize(row.email));
      out.set(row.task_id, set);
    }
    return out;
  };
  const assigneesByTask = groupByTask(assigneeRows);
  const participantsByTask = groupByTask(participantRows);

  for (const pair of pairs) {
    const email = normalize(pair.email);
    const viewer = viewers.get(email);
    const task = metaById.get(pair.entityId);
    if (!viewer || !task) continue;
    const actor = taskActorFromGrants(email, viewer.grants);
    const agent = normalize(task.agent_email);
    const isAssistant = Boolean(agent) && viewer.assistantAgents.includes(agent);
    const facts = {
      isAssignee:
        normalize(task.assignee_email) === email ||
        Boolean(assigneesByTask.get(task.id)?.has(email)),
      isReporter: normalize(task.reporter_email) === email,
      isParticipant: Boolean(participantsByTask.get(task.id)?.has(email)),
      isAgentOwner: Boolean(agent) && (agent === email || isAssistant),
      isAgentMember: isAssistant,
      // Cùng luật resolveTaskQueueScope: hàng đợi chung chỉ cho người không
      // phải agent roster và không là assistant.
      seesAllTasks:
        hasGrant(actor.grants, "task.read", "all") ||
        (hasGrant(actor.grants, "task.read", "shared_queue") &&
          !viewer.isAgent &&
          viewer.assistantAgents.length === 0),
    };
    if (canViewTask(actor, { assignee_email: task.assignee_email, agent_email: task.agent_email }, facts)) {
      allowed.add(audienceKey(pair.entityId, email));
    }
  }
  return allowed;
}

type EnrollmentMeta = {
  id: string;
  agent_email: string | null;
  caller_email: string | null;
  responsible_enroll_email: string | null;
  created_by_email: string;
};

/** Các cặp (hồ sơ, người) mà người đó MỞ ĐƯỢC hồ sơ — theo scope của trang Enrollment. */
export async function enrollmentViewersAmong(
  pairs: readonly AudiencePair[]
): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (pairs.length === 0) return allowed;
  const recordIds = [...new Set(pairs.map((pair) => pair.entityId))];

  const [viewers, recordRows] = await Promise.all([
    loadViewers(pairs.map((pair) => pair.email)),
    selectIn<EnrollmentMeta>(
      "enrollment_records",
      "id,agent_email,caller_email,responsible_enroll_email,created_by_email",
      "id",
      recordIds
    ),
  ]);
  const recordById = new Map(recordRows.map((row) => [row.id, row]));

  for (const pair of pairs) {
    const email = normalize(pair.email);
    const viewer = viewers.get(email);
    const record = recordById.get(pair.entityId);
    if (!viewer || !record) continue;
    const actor = enrollmentActorFromGrants(email, viewer.grants);
    if (!canAccessEnrollment(actor)) continue;
    const scope = enrollmentScopeFor(actor, {
      isAgent: viewer.isAgent,
      assistantAgents: viewer.assistantAgents,
    });
    if (isRecordInScope(scope, record)) allowed.add(audienceKey(pair.entityId, email));
  }
  return allowed;
}

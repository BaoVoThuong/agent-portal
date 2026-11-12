import { getSupabaseAdmin } from "@/lib/supabase";
import {
  LIST_ENRICH_CONCURRENCY,
  mapWithConcurrency,
} from "@/lib/pagination/concurrency";
import { cache } from "react";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { createSharedLookup } from "@/lib/shared-lookup";
import { fetchActiveRoleIdsWithAnyPermission } from "@/lib/rbac/permission-holders";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllRowsById, FULL_READ_PAGE_SIZE } from "@/lib/pagination/all-rows";
import { buildTaskActor } from "./access";
import { taskPositionKind, taskPositionLabel } from "./positions";

export type TaskPersonRole = {
  kind: "admin" | "agent" | "assistant" | "cs";
  label: string;
};
export type TaskAssignee = {
  email: string;
  name: string | null;
  /** At most one: the person's highest label (positions.ts). Empty without Tasks access. */
  roles?: TaskPersonRole[];
};
export type TaskAgent = TaskAssignee;
export type TaskAssigneeRow = { task_id: string; email: string; created_at: string };

type SupabaseErrorLike = { code?: string; message?: string };
type AttachAssigneeOptions = { currentEmail?: string | null };
// Keep the URL bounded; each chunk's result is paged separately below.
const TASK_ASSIGNEE_TASK_ID_CHUNK_SIZE = 300;
type AccountRoleRow = {
  id: string;
  email: string;
  name: string | null;
  user_roles?: Array<{
    roles: {
      is_active: boolean;
      role_permissions: Array<{ permission_key: string }> | null;
    } | null;
  }> | null;
};

// task_agents and agent_members change only through Account Manager → Edit
// account (PATCH /api/admin/users/[id], update_account_atomic), which calls
// invalidateTaskMembershipLookups() when Position or Assistant Agents change. Other
// server instances pick a change up within this window, so adding or removing
// an agent or assistant can take up to a minute to change what someone sees.
export const TASK_MEMBERSHIP_REUSE_MS = 60 * 1000;

const selectedAgentEmails = createSharedLookup(
  async (): Promise<string[]> => {
    const { data, error } = await getSupabaseAdmin()
      .from("task_agents")
      .select("email");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => (row as { email: string }).email);
  },
  { ttlMs: TASK_MEMBERSHIP_REUSE_MS },
);

export function invalidateSelectedAgentEmails(): void {
  selectedAgentEmails.invalidate();
}

// Still throws on a read failure (see fetchAssistantAgentsForCs): a failed read
// is never reused, so it stays fail-closed.
export const fetchSelectedAgentEmails = cache(
  async (): Promise<Set<string>> => new Set(await selectedAgentEmails.get("all")),
);

const fetchAssistantMemberRows = cache(
  async (): Promise<Array<{ agent_email: string; cs_email: string }>> => {
    const { data, error } = await getSupabaseAdmin()
      .from("agent_members")
      .select("agent_email,cs_email")
      .eq("is_assistant", true);
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{ agent_email: string; cs_email: string }>;
  }
);

// Active accounts whose active role grants task.work or task.manage. Used by the
// assignee picker (manager only).
export const fetchTaskAssignees = cache(async (): Promise<TaskAssignee[]> => {
  const supabase = getSupabaseAdmin();

  const roleIds = await fetchActiveRoleIdsWithAnyPermission([
    PERMISSIONS.TASK_WORK,
    PERMISSIONS.TASK_MANAGE,
  ]);
  if (roleIds.length === 0) return [];

  const { data: ur, error: urErr } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role_id", roleIds);
  if (urErr) throw new Error(urErr.message);

  const userIds = [...new Set((ur ?? []).map((r) => (r as { user_id: string }).user_id))];
  if (userIds.length === 0) return [];

  const { data: accounts, error: accErr } = await supabase
    .from("portal_account")
    .select("id,email,name,is_active,user_roles(roles(is_active,role_permissions(permission_key)))")
    .in("id", userIds)
    .eq("is_active", true);
  if (accErr) throw new Error(accErr.message);

  return enrichTaskPeopleRoles((accounts ?? []) as unknown as AccountRoleRow[]);
});

export async function isEligibleTaskAssigneeEmail(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const assignees = await fetchTaskAssignees();
  return assignees.some((assignee) => assignee.email.trim().toLowerCase() === normalized);
}

// Cùng tập người với fetchTaskAssignees nhưng chỉ lấy email: bên kia còn dựng
// nhãn vai trò cho ô chọn người, thêm 2–3 lượt đọc nối đuôi mà việc kiểm "có
// được gán không" không cần. Join thẳng user_roles trong một lượt thay cho
// user_roles → portal_account. Đã so trên dữ liệu thật 2026-10-25: cùng 47 email.
async function fetchEligibleTaskAssigneeEmails(): Promise<Set<string>> {
  const roleIds = await fetchActiveRoleIdsWithAnyPermission([
    PERMISSIONS.TASK_WORK,
    PERMISSIONS.TASK_MANAGE,
  ]);
  if (roleIds.length === 0) return new Set();

  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email,user_roles!inner(role_id)")
    .in("user_roles.role_id", roleIds)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return new Set(
    (data ?? []).map((row) => (row as { email: string }).email.trim().toLowerCase())
  );
}

export async function findIneligibleTaskAssigneeEmail(
  emails: readonly string[]
): Promise<string | null> {
  const normalized = emails
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) return null;

  const eligible = await fetchEligibleTaskAssigneeEmails();
  return normalized.find((email) => !eligible.has(email)) ?? null;
}

export async function fetchTaskAgents(): Promise<TaskAgent[]> {
  const supabase = getSupabaseAdmin();
  const { data: selected, error: selectedErr } = await supabase
    .from("task_agents")
    .select("email");
  if (selectedErr) throw new Error(selectedErr.message);

  const emails = [...new Set((selected ?? []).map((row) => (row as { email: string }).email))];
  if (emails.length === 0) return [];

  const { data: accounts, error } = await supabase
    .from("portal_account")
    .select("id,email,name,is_active,user_roles(roles(is_active,role_permissions(permission_key)))")
    .in("email", emails)
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  return enrichTaskPeopleRoles((accounts ?? []) as unknown as AccountRoleRow[]);
}

export async function fetchTaskAgentCandidates(): Promise<TaskAgent[]> {
  const { data: accounts, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("id,email,name,is_active,user_roles(roles(is_active,role_permissions(permission_key)))")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  return enrichTaskPeopleRoles((accounts ?? []) as unknown as AccountRoleRow[]);
}

async function enrichTaskPeopleRoles(rows: AccountRoleRow[]): Promise<TaskAssignee[]> {
  const people = rows.map((account) => ({
    email: account.email,
    name: account.name,
  }));
  if (people.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const [selectedAgentEmails, assistantRows] = await Promise.all([
    fetchSelectedAgentEmails(),
    fetchAssistantMemberRows(),
  ]);

  const accountByEmail = new Map(rows.map((account) => [account.email, account]));
  const nameByEmail = new Map(people.map((person) => [person.email, person.name]));
  const missingAgentEmails = [
    ...new Set(
      assistantRows
        .map((row) => row.agent_email)
        .filter((email) => !nameByEmail.has(email))
    ),
  ];
  if (missingAgentEmails.length > 0) {
    const { data, error } = await supabase
      .from("portal_account")
      .select("email,name")
      .in("email", missingAgentEmails)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ email: string; name: string | null }>) {
      nameByEmail.set(row.email, row.name);
    }
  }

  const assistantAgentsByEmail = new Map<string, string[]>();
  for (const row of assistantRows) {
    const current = assistantAgentsByEmail.get(row.cs_email) ?? [];
    assistantAgentsByEmail.set(row.cs_email, [...current, row.agent_email]);
  }

  return sortPeople(
    people.map((person) => {
      const account = accountByEmail.get(person.email);
      const actor = buildTaskActor(account ? activeRolePermissionKeys(account) : [], person.email);
      const assistantAgents = assistantAgentsByEmail.get(person.email) ?? [];
      // One label, the highest: Admin > Agent > Assistant > Customer Service
      // (positions.ts). Display only, never access.
      const kind = taskPositionKind({
        isManager: actor.isManager,
        isWorker: actor.isWorker,
        isAgent: selectedAgentEmails.has(person.email),
        isAssistant: assistantAgents.length > 0,
      });
      const roles: TaskPersonRole[] = kind
        ? [
            {
              kind,
              label: taskPositionLabel(
                kind,
                assistantAgents.map((agentEmail) => nameByEmail.get(agentEmail)?.trim() || agentEmail)
              ),
            },
          ]
        : [];

      return { ...person, roles };
    })
  );
}

function activeRolePermissionKeys(account: AccountRoleRow): string[] {
  return (account.user_roles ?? []).flatMap((row) =>
    row.roles?.is_active
      ? (row.roles.role_permissions ?? []).map((permission) => permission.permission_key)
      : []
  );
}

export async function fetchTaskAssigneeEmails(
  taskId: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<string[]> {
  const { data, error } = await readAllRowsById<{ id: string; created_at: string }>(
    (afterEmail, pageSize, withCount) => {
      let query = supabase.from("task_assignees")
        .select("id:email,created_at", withCount ? { count: "exact" } : undefined)
        .eq("task_id", taskId);
      if (afterEmail) query = query.gt("email", afterEmail);
      return query.order("email").limit(pageSize);
    },
  );
  if (error) {
    if (isTaskAssigneesMissingError(error)) return [];
    throw new Error(error.message);
  }

  return [
    ...new Set(
      [...(data ?? [])]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((row) => row.id?.trim())
        .filter(Boolean)
    ),
  ];
}

export async function fetchAssignedTaskIdsForEmail(
  email: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<string[]> {
  const { data, error } = await readAllRowsById<{ id: string }>(
    (afterTaskId, pageSize, withCount) => {
      let query = supabase.from("task_assignees")
        .select("id:task_id", withCount ? { count: "exact" } : undefined)
        .eq("email", email);
      if (afterTaskId) query = query.gt("task_id", afterTaskId);
      return query.order("task_id").limit(pageSize);
    },
  );
  if (error) {
    if (isTaskAssigneesMissingError(error)) return [];
    throw new Error(error.message);
  }

  return [
    ...new Set(
      ((data ?? []) as { id: string }[])
        .map((row) => row.id)
        .filter(Boolean)
    ),
  ];
}

export async function isTaskAssignee(
  taskId: string,
  email: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<boolean> {
  const { data, error } = await supabase
    .from("task_assignees")
    .select("email")
    .eq("task_id", taskId)
    .eq("email", email)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isTaskAssigneesMissingError(error)) return false;
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function attachAssigneesToTasks<
  T extends { id: string; assignee_email?: string | null },
>(
  tasks: T[],
  supabase: SupabaseClient = getSupabaseAdmin(),
  options: AttachAssigneeOptions = {}
): Promise<(T & { assignees: string[]; assignee_started_at: string | null })[]> {
  if (tasks.length === 0) return [];

  const ids = tasks.map((task) => task.id);
  const assigneeRows = await fetchTaskAssigneeRowsForTaskIds(ids, supabase);
  if (!assigneeRows) return attachLegacyAssignees(tasks);

  const rowsByTask = new Map<string, TaskAssigneeRow[]>();
  for (const row of assigneeRows) {
    const list = rowsByTask.get(row.task_id) ?? [];
    if (!list.some((existing) => existing.email === row.email)) list.push(row);
    rowsByTask.set(row.task_id, list);
  }

  return tasks.map((task) => {
    const rows = rowsByTask.get(task.id) ?? [];
    const fromJunction = rows.map((row) => row.email);
    const legacyFallback =
      fromJunction.length === 0 && task.assignee_email ? [task.assignee_email] : [];
    const currentAssigneeRow = options.currentEmail
      ? rows.find((row) => row.email === options.currentEmail)
      : null;
    const assigneeStartedAt =
      currentAssigneeRow?.created_at ??
      rows[0]?.created_at ??
      ((task as { created_at?: string }).created_at ?? null);

    return {
      ...task,
      assignees: fromJunction.length > 0 ? fromJunction : legacyFallback,
      assignee_started_at:
        fromJunction.length > 0 || legacyFallback.length > 0 ? assigneeStartedAt : null,
    };
  });
}

export async function fetchTaskAssigneeRowsForTaskIds(
  taskIds: string[],
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<TaskAssigneeRow[] | null> {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const rows: TaskAssigneeRow[] = [];
  // Chặn số lượt song song: chia 50 id/chùm rồi `Promise.all` TOÀN BỘ chùm là
  // 3 truy vấn ở 141 task nhưng 100 ở 5.000 task, vào một pool 10 kết nối.
  const results = await mapWithConcurrency(
    chunkValues(ids, TASK_ASSIGNEE_TASK_ID_CHUNK_SIZE),
    LIST_ENRICH_CONCURRENCY,
    async (chunk) => {
      try {
        // Keyset on the primary key (task_id, email), the same stop rule as
        // readAllRowsById. OFFSET skipped a row when an assignee was removed
        // between pages (and the count check then failed the whole board) and
        // read one twice when an assignee was added.
        const chunkRows: TaskAssigneeRow[] = [];
        let after: TaskAssigneeRow | null = null;
        let total: number | null = null;
        for (;;) {
          let query = supabase
            .from("task_assignees")
            .select("task_id,email,created_at", after ? undefined : { count: "exact" })
            .in("task_id", chunk);
          if (after) query = query.or(assigneesAfter(after));
          const result = await query
            .order("task_id", { ascending: true })
            .order("email", { ascending: true })
            .limit(FULL_READ_PAGE_SIZE);
          if (result.error) return { data: null, error: result.error };
          if (!after && typeof result.count === "number") total = result.count;
          const batch = (result.data ?? []) as TaskAssigneeRow[];
          if (batch.length === 0) break;
          chunkRows.push(...batch);
          after = batch[batch.length - 1];
          if (batch.length < FULL_READ_PAGE_SIZE && total !== null && chunkRows.length >= total) {
            break;
          }
        }
        return { data: chunkRows, error: null };
      } catch (error) {
        if (isFetchFailedError(error)) return null;
        throw error;
      }
    }
  );

  for (const result of results) {
    if (!result) return null;
    if (result.error) {
      if (isTaskAssigneesMissingError(result.error)) return null;
      throw new Error(result.error.message ?? "Could not load task assignees.");
    }

    rows.push(...((result.data ?? []) as TaskAssigneeRow[]));
  }

  return rows.sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/**
 * PostgREST `or` filter for rows after `row` in (task_id, email) order. The
 * email is quoted so an unusual address cannot alter the filter grammar.
 */
export function assigneesAfter(row: Pick<TaskAssigneeRow, "task_id" | "email">): string {
  const email = `"${row.email.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `task_id.gt.${row.task_id},and(task_id.eq.${row.task_id},email.gt.${email})`;
}

function sortPeople<T extends TaskAssignee>(people: T[]): T[] {
  return [...people].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

export function isTaskAssigneesMissingError(error: SupabaseErrorLike): boolean {
  const message = error.message ?? "";
  return (
    (error.code === "PGRST205" || message.includes("schema cache")) &&
    message.includes("task_assignees")
  );
}

function isFetchFailedError(error: unknown): boolean {
  return error instanceof TypeError && error.message.toLowerCase().includes("fetch failed");
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function attachLegacyAssignees<T extends { assignee_email?: string | null }>(
  tasks: T[]
): (T & { assignees: string[]; assignee_started_at: string | null })[] {
  return tasks.map((task) => ({
    ...task,
    assignees: task.assignee_email ? [task.assignee_email] : [],
    assignee_started_at: task.assignee_email
      ? ((task as { created_at?: string }).created_at ?? null)
      : null,
  }));
}

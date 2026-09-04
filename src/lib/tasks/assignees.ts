import { getSupabaseAdmin } from "@/lib/supabase";
import {
  LIST_ENRICH_CONCURRENCY,
  mapWithConcurrency,
} from "@/lib/pagination/concurrency";
import { cache } from "react";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  LEGACY_SUPER_ADMIN_ROLE_NAME,
  SYSTEM_ROLE_NAMES,
} from "@/lib/rbac/system-roles";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TaskPersonRole = {
  kind: "admin" | "agent" | "assistant" | "cs";
  label: string;
};
export type TaskAssignee = {
  email: string;
  name: string | null;
  roles?: TaskPersonRole[];
};
export type TaskAgent = TaskAssignee;
export type TaskAssigneeRow = { task_id: string; email: string; created_at: string };

type SupabaseErrorLike = { code?: string; message?: string };
type AttachAssigneeOptions = { currentEmail?: string | null };
// Cùng lý do với TASK_METADATA_TASK_ID_CHUNK_SIZE: `.in("task_id", ...)` đi
// trong URL nên chùm không được quá lớn, nhưng 50 là quá dè dặt — 300 UUID có
// nháy là ~11 KB, vẫn dưới giới hạn URL thông dụng. Ở 5.000 task: 100 lượt → 17.
const TASK_ASSIGNEE_TASK_ID_CHUNK_SIZE = 300;
type AccountRoleRow = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  user_roles?: Array<{
    roles: { name: string; is_active: boolean } | null;
  }> | null;
};

export const fetchSelectedAgentEmails = cache(async (): Promise<Set<string>> => {
  const { data, error } = await getSupabaseAdmin()
    .from("task_agents")
    .select("email");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => (row as { email: string }).email));
});

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

// Active accounts whose role grants task.work or task.manage. Used by the
// assignee picker (manager only).
export const fetchTaskAssignees = cache(async (): Promise<TaskAssignee[]> => {
  const supabase = getSupabaseAdmin();

  const { data: rp, error: rpErr } = await supabase
    .from("role_permissions")
    .select("role_id")
    .in("permission_key", [PERMISSIONS.TASK_WORK, PERMISSIONS.TASK_MANAGE]);
  if (rpErr) throw new Error(rpErr.message);

  const roleIds = [...new Set((rp ?? []).map((r) => (r as { role_id: string }).role_id))];
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
    .select("id,email,name,is_active,role,user_roles(roles(name,is_active))")
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

export async function findIneligibleTaskAssigneeEmail(
  emails: readonly string[]
): Promise<string | null> {
  const normalized = emails
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) return null;

  const assignees = await fetchTaskAssignees();
  const eligible = new Set(
    assignees.map((assignee) => assignee.email.trim().toLowerCase())
  );
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
    .select("id,email,name,is_active,role,user_roles(roles(name,is_active))")
    .in("email", emails)
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  return enrichTaskPeopleRoles((accounts ?? []) as unknown as AccountRoleRow[]);
}

export async function fetchTaskAgentCandidates(): Promise<TaskAgent[]> {
  const { data: accounts, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("id,email,name,is_active,role,user_roles(roles(name,is_active))")
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
      const roles: TaskPersonRole[] = [];
      if (account && isAdminAccount(account)) {
        roles.push({ kind: "admin", label: "Admin" });
      }
      if (selectedAgentEmails.has(person.email)) {
        roles.push({ kind: "agent", label: "Agent" });
      }
      for (const agentEmail of assistantAgentsByEmail.get(person.email) ?? []) {
        const agentLabel = nameByEmail.get(agentEmail)?.trim() || agentEmail;
        roles.push({ kind: "assistant", label: `Assistant to ${agentLabel}` });
      }
      if (roles.length === 0) {
        roles.push({ kind: "cs", label: "Customer Service" });
      }

      return { ...person, roles };
    })
  );
}

function isAdminAccount(account: AccountRoleRow): boolean {
  const activeRoleNames = (account.user_roles ?? [])
    .map((row) => row.roles)
    .filter((role): role is { name: string; is_active: boolean } =>
      Boolean(role?.is_active)
    )
    .map((role) => role.name);
  return (
    account.role === "admin" ||
    activeRoleNames.includes(SYSTEM_ROLE_NAMES.SUPER_ADMIN) ||
    activeRoleNames.includes(LEGACY_SUPER_ADMIN_ROLE_NAME)
  );
}

export async function fetchTaskAssigneeEmails(
  taskId: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<string[]> {
  const { data, error } = await supabase
    .from("task_assignees")
    .select("email,created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isTaskAssigneesMissingError(error)) return [];
    throw new Error(error.message);
  }

  return [
    ...new Set(
      ((data ?? []) as unknown as { email: string }[])
        .map((row) => row.email?.trim())
        .filter(Boolean)
    ),
  ];
}

export async function fetchAssignedTaskIdsForEmail(
  email: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<string[]> {
  const { data, error } = await supabase
    .from("task_assignees")
    .select("task_id")
    .eq("email", email);
  if (error) {
    if (isTaskAssigneesMissingError(error)) return [];
    throw new Error(error.message);
  }

  return [
    ...new Set(
      ((data ?? []) as unknown as { task_id: string }[])
        .map((row) => row.task_id)
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
      let result:
        | {
            data: unknown[] | null;
            error: SupabaseErrorLike | null;
          }
        | null = null;
      try {
        result = await supabase
          .from("task_assignees")
          .select("task_id,email,created_at")
          .in("task_id", chunk)
          .order("created_at", { ascending: true });
      } catch (error) {
        if (isFetchFailedError(error)) return null;
        throw error;
      }
      return result;
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

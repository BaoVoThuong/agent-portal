import { getSupabaseAdmin } from "@/lib/supabase";
import { flattenAccess, type AccessRow, type UserAccess } from "@/lib/rbac/access";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { isTaskViewAdmin, buildTaskActor } from "@/lib/tasks/access";
import { fetchSelectedAgentEmails } from "@/lib/tasks/assignees";
import type { EnrollmentNotificationInsertInput } from "./notifications";
import { canAccessEnrollment, type EnrollmentActor } from "./access";
import {
  buildEnrollmentScope,
  isRecordInScope,
  type EnrollmentScope,
} from "./scope";

type RecipientAccountRow = AccessRow & { email: string };

type EnrollmentNotificationRecord = {
  id: string;
  agent_email: string | null;
  caller_email: string | null;
  responsible_enroll_email: string | null;
  created_by_email: string | null;
  archived_at: string | null;
};

export type EnrollmentNotificationScopeLoaders = {
  loadScopes: (emails: readonly string[]) => Promise<Map<string, EnrollmentScope | null>>;
  loadRecords: (ids: readonly string[]) => Promise<Map<string, EnrollmentNotificationRecord>>;
};

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

async function loadActiveAccounts(emails?: readonly string[]): Promise<RecipientAccountRow[]> {
  const normalized = emails
    ? [...new Set(emails.map(normalize).filter(Boolean))]
    : undefined;
  if (normalized && normalized.length === 0) return [];

  let query = getSupabaseAdmin()
    .from("portal_account")
    .select(
      "id,email,role,is_active,agent_id,user_roles(roles(id,name,is_active,role_permissions(permission_key)))"
    )
    .eq("is_active", true);
  if (normalized) query = query.in("email", normalized);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RecipientAccountRow[];
}

function actorFromAccess(access: UserAccess, email: string): EnrollmentActor {
  return buildTaskActor(access.permissions, email, {
    isAdmin: isTaskViewAdmin({ role: access.legacyRole, roles: access.roles }),
  });
}

/** Resolve the current Enrollment scope for a set of notification recipients. */
export async function loadEnrollmentRecipientScopes(
  emails: readonly string[],
): Promise<Map<string, EnrollmentScope | null>> {
  const normalizedEmails = [...new Set(emails.map(normalize).filter(Boolean))];
  const result = new Map<string, EnrollmentScope | null>();
  if (normalizedEmails.length === 0) return result;

  const [accounts, assistantRows, selectedAgents] = await Promise.all([
    loadActiveAccounts(normalizedEmails),
    getSupabaseAdmin()
      .from("agent_members")
      .select("agent_email,cs_email")
      .in("cs_email", normalizedEmails)
      .eq("is_assistant", true),
    fetchSelectedAgentEmails(),
  ]);
  if (assistantRows.error) throw new Error(assistantRows.error.message);

  const accountByEmail = new Map(
    accounts.map((row) => [normalize(row.email), flattenAccess(row) as UserAccess]),
  );
  const assistantAgentsByCs = new Map<string, string[]>();
  for (const row of (assistantRows.data ?? []) as Array<{
    agent_email: string;
    cs_email: string;
  }>) {
    const csEmail = normalize(row.cs_email);
    const agentEmail = normalize(row.agent_email);
    if (!csEmail || !agentEmail) continue;
    const agents = assistantAgentsByCs.get(csEmail) ?? [];
    agents.push(agentEmail);
    assistantAgentsByCs.set(csEmail, agents);
  }
  const selected = new Set([...selectedAgents].map(normalize));

  for (const email of normalizedEmails) {
    const access = accountByEmail.get(email);
    if (!access || !access.isActive) {
      result.set(email, null);
      continue;
    }
    const actor = actorFromAccess(access, email);
    if (!canAccessEnrollment(actor)) {
      result.set(email, null);
      continue;
    }
    result.set(
      email,
      buildEnrollmentScope({
        actor,
        isSelectedAgent: selected.has(email),
        assistantAgentEmails: assistantAgentsByCs.get(email) ?? [],
      }),
    );
  }
  return result;
}

/** Enrollment's single manager audience: the same audience that sees all records. */
export async function fetchEnrollmentManagerEmails(): Promise<string[]> {
  const accounts = await loadActiveAccounts();
  return [
    ...new Set(
      accounts
        .map((row) => {
          const access = flattenAccess(row);
          if (!access.permissions.includes(PERMISSIONS.TASK_MANAGE)) return null;
          const actor = actorFromAccess(access, normalize(row.email));
          return actor.isManager ? normalize(row.email) : null;
        })
        .filter((email): email is string => Boolean(email)),
    ),
  ];
}

async function loadEnrollmentNotificationRecords(
  ids: readonly string[],
): Promise<Map<string, EnrollmentNotificationRecord>> {
  const result = new Map<string, EnrollmentNotificationRecord>();
  if (ids.length === 0) return result;
  const { data, error } = await getSupabaseAdmin()
    .from("enrollment_records")
    .select(
      "id,agent_email,caller_email,responsible_enroll_email,created_by_email,archived_at",
    )
    .in("id", [...new Set(ids)]);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as EnrollmentNotificationRecord[]) {
    result.set(row.id, row);
  }
  return result;
}

const defaultLoaders: EnrollmentNotificationScopeLoaders = {
  loadScopes: loadEnrollmentRecipientScopes,
  loadRecords: loadEnrollmentNotificationRecords,
};

/**
 * Keep notification rows only when the recipient can still access the record.
 * A missing account, missing record, archived record, or scope lookup error is
 * fail-closed so notification fan-out never becomes a data disclosure path.
 */
export async function filterEnrollmentNotificationRows(
  rows: readonly EnrollmentNotificationInsertInput[],
  loaders: EnrollmentNotificationScopeLoaders = defaultLoaders,
): Promise<{ kept: EnrollmentNotificationInsertInput[]; droppedCount: number }> {
  if (rows.length === 0) return { kept: [], droppedCount: 0 };
  const records = await loaders.loadRecords(rows.map((row) => row.record_id));
  const scopes = await loaders.loadScopes(rows.map((row) => row.recipient_email));
  const kept = rows.filter((row) => {
    const record = records.get(row.record_id);
    const scope = scopes.get(normalize(row.recipient_email));
    return Boolean(
      record && !record.archived_at && scope && isRecordInScope(scope, record),
    );
  });
  return { kept, droppedCount: rows.length - kept.length };
}

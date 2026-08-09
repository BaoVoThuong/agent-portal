import { fetchSelectedAgentEmails } from "@/lib/tasks/assignees";
import {
  fetchAgentsForCs,
  fetchAssistantAgentsForCs,
} from "@/lib/tasks/membership";
import type { EnrollmentActor } from "./access";
import type { EnrollmentRecordWithStats } from "./types";

export type EnrollmentScope =
  | { seeAll: true }
  | { seeAll: false; agentEmails: string[] };

type ScopeableQuery = {
  eq: (column: string, value: unknown) => unknown;
  in: (column: string, values: readonly string[]) => unknown;
};

const NO_SCOPE_RECORD_ID = "00000000-0000-0000-0000-000000000000";

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Managers and plain workers see the shared queue. Agents and promoted
 * assistants are restricted to records owned by agents they cover.
 */
export async function resolveEnrollmentScope(
  actor: EnrollmentActor
): Promise<EnrollmentScope> {
  if (actor.isManager) return { seeAll: true };
  if (!actor.isWorker) return { seeAll: false, agentEmails: [] };

  const [selectedAgentEmails, assistantAgents] = await Promise.all([
    fetchSelectedAgentEmails(),
    fetchAssistantAgentsForCs(actor.email),
  ]);
  const normalizedActor = normalize(actor.email);
  const isAgent = [...selectedAgentEmails].some(
    (email) => normalize(email) === normalizedActor
  );
  const isAssistant = assistantAgents.length > 0;
  if (!isAgent && !isAssistant) return { seeAll: true };

  const covered = await fetchAgentsForCs(actor.email);
  return {
    seeAll: false,
    agentEmails: [
      ...new Set(
        [
          ...(isAgent ? [actor.email] : []),
          ...assistantAgents,
          ...covered,
        ]
          .map(normalize)
          .filter(Boolean)
      ),
    ],
  };
}

/** Fail closed: a null agent is never visible to a scoped viewer. */
export function isRecordInScope(
  scope: EnrollmentScope,
  agentEmail: string | null
): boolean {
  if (scope.seeAll) return true;
  const normalizedAgent = normalize(agentEmail);
  if (!normalizedAgent) return false;
  return scope.agentEmails.some(
    (email) => normalize(email) === normalizedAgent
  );
}

/** Applies the scope to an enrollment_records query. */
export function applyEnrollmentScope<TQuery>(
  query: TQuery,
  scope: EnrollmentScope
): TQuery {
  if (scope.seeAll) return query;
  const scopeable = query as unknown as ScopeableQuery;
  if (scope.agentEmails.length === 0) {
    return scopeable.eq("id", NO_SCOPE_RECORD_ID) as TQuery;
  }
  return scopeable.in("agent_email", scope.agentEmails) as TQuery;
}

/**
 * Loads one canonical record and hides both missing and out-of-scope IDs behind
 * a 404 so callers cannot use the API to confirm that another agent's UUID
 * exists. The dynamic import avoids a module cycle once queries.ts consumes the
 * pure query-scoping helper above.
 */
export async function loadScopedEnrollmentRecord(
  id: string,
  actor: EnrollmentActor
): Promise<
  | { ok: true; record: EnrollmentRecordWithStats; scope: EnrollmentScope }
  | { ok: false; status: 404; error: "Not found" }
> {
  const [{ fetchEnrollmentRecordById }, scope] = await Promise.all([
    import("./queries"),
    resolveEnrollmentScope(actor),
  ]);
  const record = await fetchEnrollmentRecordById(id);
  if (!record || !isRecordInScope(scope, record.agent_email)) {
    return { ok: false, status: 404, error: "Not found" };
  }
  return { ok: true, record, scope };
}

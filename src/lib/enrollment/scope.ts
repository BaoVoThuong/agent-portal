import { fetchSelectedAgentEmails } from "@/lib/tasks/assignees";
import {
  fetchAgentsForCs,
  fetchAssistantAgentsForCs,
} from "@/lib/tasks/membership";
import type { EnrollmentActor } from "./access";
import type { EnrollmentRecordWithStats } from "./types";

export type EnrollmentScope =
  | { seeAll: true }
  | { seeAll: false; agentEmails: string[]; viewerEmail: string };

type ScopeableQuery = {
  eq: (column: string, value: unknown) => unknown;
  in: (column: string, values: readonly string[]) => unknown;
  or: (filters: string) => unknown;
};

const NO_SCOPE_RECORD_ID = "00000000-0000-0000-0000-000000000000";

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

// Values inside PostgREST `.or()` filters are parsed as filter grammar. Keep
// actor identities data-only so an unusual email cannot alter the predicate.
function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Managers and plain workers see the shared queue. Agents and promoted
 * assistants are restricted to records owned by agents they cover, plus
 * records where they are the creator, caller, or responsible enrollment
 * owner.
 */
export async function resolveEnrollmentScope(
  actor: EnrollmentActor
): Promise<EnrollmentScope> {
  if (actor.isManager) return { seeAll: true };
  if (!actor.isWorker) {
    return {
      seeAll: false,
      agentEmails: [],
      viewerEmail: normalize(actor.email),
    };
  }

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
    viewerEmail: normalizedActor,
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

/** Fail closed: a null-agent record is visible only via direct assignment. */
export function isRecordInScope(
  scope: EnrollmentScope,
  record: Pick<
    EnrollmentRecordWithStats,
    | "agent_email"
    | "caller_email"
    | "responsible_enroll_email"
    | "created_by_email"
  >
): boolean {
  if (scope.seeAll) return true;
  const viewerEmail = normalize(scope.viewerEmail);
  if (
    viewerEmail &&
    [
      record.created_by_email,
      record.caller_email,
      record.responsible_enroll_email,
    ].some((email) => normalize(email) === viewerEmail)
  ) {
    return true;
  }

  const normalizedAgent = normalize(record.agent_email);
  return Boolean(
    normalizedAgent &&
      scope.agentEmails.some(
        (email) => normalize(email) === normalizedAgent
      )
  );
}

/** Applies the scope to an enrollment_records query. */
export function applyEnrollmentScope<TQuery>(
  query: TQuery,
  scope: EnrollmentScope
): TQuery {
  if (scope.seeAll) return query;
  const scopeable = query as unknown as ScopeableQuery;
  const filters: string[] = [];
  if (scope.agentEmails.length > 0) {
    filters.push(
      `agent_email.in.(${scope.agentEmails
        .map(normalize)
        .filter(Boolean)
        .map(quoteFilterValue)
        .join(",")})`
    );
  }
  const viewerEmail = normalize(scope.viewerEmail);
  if (viewerEmail) {
    const quotedViewer = quoteFilterValue(viewerEmail);
    filters.push(
      `created_by_email.eq.${quotedViewer}`,
      `caller_email.eq.${quotedViewer}`,
      `responsible_enroll_email.eq.${quotedViewer}`
    );
  }
  if (filters.length === 0) {
    return scopeable.eq("id", NO_SCOPE_RECORD_ID) as TQuery;
  }
  return scopeable.or(filters.join(",")) as TQuery;
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
  // The record lookup is needed to enforce the final scope decision, but it
  // does not depend on resolving the actor's covered agents. Start both
  // reads together to remove one network round-trip from every detail route.
  // This remains fail-closed: the record is never returned until the scope
  // check below has completed, and detail data is loaded only by the caller
  // after this function succeeds.
  const queriesPromise = import("./queries");
  const scopePromise = resolveEnrollmentScope(actor);
  const recordPromise = queriesPromise.then(({ fetchEnrollmentRecordById }) =>
    fetchEnrollmentRecordById(id),
  );
  const [record, scope] = await Promise.all([recordPromise, scopePromise]);
  if (!record || !isRecordInScope(scope, record)) {
    return { ok: false, status: 404, error: "Not found" };
  }
  return { ok: true, record, scope };
}

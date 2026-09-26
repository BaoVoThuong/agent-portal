import { fetchSelectedAgentEmails } from "@/lib/tasks/assignees";
import {
  fetchAgentsForCs,
  fetchAssistantAgentsForCs,
} from "@/lib/tasks/membership";
import { grantedScopes, hasGrant } from "@/lib/authz/grants";
import type { EnrollmentActor } from "./access";
import type { EnrollmentRecordWithStats } from "./types";

/** Cột nhận diện người xem trên hồ sơ, theo scope: reported / assigned. */
export type EnrollmentViewerColumn =
  | "created_by_email"
  | "caller_email"
  | "responsible_enroll_email";

const ALL_VIEWER_COLUMNS: readonly EnrollmentViewerColumn[] = [
  "created_by_email",
  "caller_email",
  "responsible_enroll_email",
];

export type EnrollmentScope =
  | { seeAll: true }
  | {
      seeAll: false;
      agentEmails: string[];
      viewerEmail: string;
      /** Thiếu = cả ba cột (hình dạng cũ). */
      viewerColumns?: readonly EnrollmentViewerColumn[];
    };

function viewerColumnsFor(actor: EnrollmentActor): EnrollmentViewerColumn[] {
  const scopes = grantedScopes(actor.grants, "enrollment.read");
  return [
    ...(scopes.includes("reported") ? (["created_by_email"] as const) : []),
    ...(scopes.includes("assigned")
      ? (["caller_email", "responsible_enroll_email"] as const)
      : []),
  ];
}

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
 * Phạm vi đọc Enrollment, theo grant `enrollment.read`:
 *   - `all` → mọi hồ sơ;
 *   - `shared_queue` → mọi hồ sơ, NHƯNG chỉ khi người này không phải agent
 *     roster cũng không là assistant (compat D7: agent/assistant bị thu về hồ
 *     sơ của agent mình);
 *   - còn lại: hồ sơ của chính mình (`agent_owned`), của agent mình là
 *     assistant (`assistant_for_agent`), và hồ sơ mình tạo (`reported`) / gọi
 *     hoặc phụ trách (`assigned`).
 */
export async function resolveEnrollmentScope(
  actor: EnrollmentActor
): Promise<EnrollmentScope> {
  if (hasGrant(actor.grants, "enrollment.read", "all")) return { seeAll: true };
  const normalizedActor = normalize(actor.email);
  if (!actor.isWorker) {
    return {
      seeAll: false,
      agentEmails: [],
      viewerEmail: normalizedActor,
      viewerColumns: [],
    };
  }

  const [selectedAgentEmails, assistantAgents] = await Promise.all([
    fetchSelectedAgentEmails(),
    fetchAssistantAgentsForCs(actor.email),
  ]);
  const isAgent = [...selectedAgentEmails].some(
    (email) => normalize(email) === normalizedActor
  );
  const isAssistant = assistantAgents.length > 0;
  if (
    !isAgent &&
    !isAssistant &&
    hasGrant(actor.grants, "enrollment.read", "shared_queue")
  ) {
    return { seeAll: true };
  }

  const covered = hasGrant(actor.grants, "enrollment.read", "assistant_for_agent")
    ? [...assistantAgents, ...(await fetchAgentsForCs(actor.email))]
    : [];
  const ownsOwn = isAgent && hasGrant(actor.grants, "enrollment.read", "agent_owned");
  return {
    seeAll: false,
    viewerEmail: normalizedActor,
    viewerColumns: viewerColumnsFor(actor),
    agentEmails: [
      ...new Set(
        [...(ownsOwn ? [actor.email] : []), ...covered]
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
  const columns = scope.viewerColumns ?? ALL_VIEWER_COLUMNS;
  if (
    viewerEmail &&
    columns.some((column) => normalize(record[column]) === viewerEmail)
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
    for (const column of scope.viewerColumns ?? ALL_VIEWER_COLUMNS) {
      filters.push(`${column}.eq.${quotedViewer}`);
    }
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

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchSelectedAgentEmails } from "@/lib/tasks/assignees";
import { fetchAssistantAgentsForCs } from "@/lib/tasks/membership";
import type { EnrollmentActor } from "./access";
import {
  ENROLLMENT_PROGRAMS,
  isEnrollmentProgram,
  type EnrollmentProgram,
  type EnrollmentRecordWithStats,
} from "./types";

/**
 * A custom Person column of one program. Whoever is picked in it can see the
 * record, the way Caller and Responsible do (user decision 2026-10-21: any
 * active custom Person column, so a new column works without a code change).
 */
export type ViewerPersonColumn = { program: EnrollmentProgram; key: string; label?: string };

export type EnrollmentScope =
  | { seeAll: true }
  | {
      seeAll: false;
      agentEmails: string[];
      viewerEmail: string;
      personColumns: readonly ViewerPersonColumn[];
    };

export type EnrollmentScopeInputs = {
  actor: EnrollmentActor;
  isSelectedAgent: boolean;
  assistantAgentEmails: readonly string[];
  personColumns: readonly ViewerPersonColumn[];
};

type ScopeableQuery = {
  eq: (column: string, value: unknown) => unknown;
  in: (column: string, values: readonly string[]) => unknown;
  or: (filters: string) => unknown;
};

const NO_SCOPE_RECORD_ID = "00000000-0000-0000-0000-000000000000";

// Keys come from slugifyColumnKey. Anything else is skipped rather than
// interpolated into a PostgREST filter.
const SAFE_COLUMN_KEY = /^[a-z0-9_]+$/;

type ScopedRecord = {
  program: string | null;
  agent_email: string | null;
  caller_email: string | null;
  responsible_enroll_email: string | null;
  created_by_email: string | null;
  custom_values?: Record<string, unknown> | null;
};

/** Emails picked in a Person column: one email, or a list of them. */
export function personFieldEmails(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

// Values inside PostgREST `.or()` filters are parsed as filter grammar. Keep
// actor identities data-only so an unusual email cannot alter the predicate.
function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Active custom Person columns of every Enrollment program. Read live, so a
 * column created or archived in /config takes effect on the next request.
 */
export async function fetchViewerPersonColumns(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<ViewerPersonColumn[]> {
  const { data, error } = await supabase
    .from("table_column")
    .select("scope,key,label")
    .in("scope", [...ENROLLMENT_PROGRAMS])
    .eq("type", "person")
    .eq("is_system", false)
    .is("archived_at", null);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { scope: string; key: string; label?: string | null }[]).flatMap((row) =>
    isEnrollmentProgram(row.scope) && SAFE_COLUMN_KEY.test(row.key)
      ? [{ program: row.scope, key: row.key, label: row.label ?? undefined }]
      : []
  );
}

/**
 * Managers and plain workers see the shared queue. Agents and promoted
 * assistants are restricted to records owned by agents they cover, plus
 * records where they are the creator, caller, responsible enrollment owner,
 * or the person picked in a custom Person column.
 */
export async function resolveEnrollmentScope(
  actor: EnrollmentActor
): Promise<EnrollmentScope> {
  // Managers already have an unrestricted scope. Avoid membership lookups so
  // a transient membership-table failure cannot block their shared queue.
  if (actor.isManager) return { seeAll: true };
  if (!actor.isWorker) {
    return {
      seeAll: false,
      agentEmails: [],
      viewerEmail: normalize(actor.email),
      personColumns: await fetchViewerPersonColumns(),
    };
  }
  const [selectedAgentEmails, assistantAgents, personColumns] = await Promise.all([
    fetchSelectedAgentEmails(),
    fetchAssistantAgentsForCs(actor.email),
    fetchViewerPersonColumns(),
  ]);
  const normalizedActor = normalize(actor.email);
  return buildEnrollmentScope({
    actor,
    isSelectedAgent: [...selectedAgentEmails].some(
      (email) => normalize(email) === normalizedActor
    ),
    assistantAgentEmails: assistantAgents,
    personColumns,
  });
}

/**
 * Builds the Enrollment visibility boundary from already loaded membership
 * facts. Keeping this pure lets notification fan-out use exactly the same
 * rule as the list/detail APIs without issuing a different authorization
 * decision per event.
 */
export function buildEnrollmentScope({
  actor,
  isSelectedAgent,
  assistantAgentEmails,
  personColumns,
}: EnrollmentScopeInputs): EnrollmentScope {
  if (actor.isManager) return { seeAll: true };
  const viewerEmail = normalize(actor.email);
  if (!actor.isWorker) {
    return { seeAll: false, agentEmails: [], viewerEmail, personColumns };
  }
  if (!isSelectedAgent && assistantAgentEmails.length === 0) {
    return { seeAll: true };
  }
  return {
    seeAll: false,
    viewerEmail,
    personColumns,
    agentEmails: [
      ...new Set(
        [
          ...(isSelectedAgent ? [actor.email] : []),
          ...assistantAgentEmails,
        ]
          .map(normalize)
          .filter(Boolean)
      ),
    ],
  };
}

/**
 * Fail closed: a null-agent record is visible only via direct assignment
 * (creator, Caller, Responsible, or a custom Person column of its program).
 */
export function isRecordInScope(scope: EnrollmentScope, record: ScopedRecord): boolean {
  if (scope.seeAll) return true;
  const viewerEmail = normalize(scope.viewerEmail);
  if (
    viewerEmail &&
    [
      record.created_by_email,
      record.caller_email,
      record.responsible_enroll_email,
      ...scope.personColumns
        .filter((column) => column.program === record.program)
        .flatMap((column) => personFieldEmails(record.custom_values?.[column.key])),
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
      `responsible_enroll_email.eq.${quotedViewer}`,
      ...scope.personColumns
        .filter((column) => SAFE_COLUMN_KEY.test(column.key))
        .map(
          (column) =>
            `and(program.eq.${column.program},custom_values->>${column.key}.eq.${quotedViewer})`
        )
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

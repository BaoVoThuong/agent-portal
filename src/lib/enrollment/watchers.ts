import { getSupabaseAdmin } from "@/lib/supabase";
import {
  fetchViewerPersonColumns,
  personFieldEmails,
  type ViewerPersonColumn,
} from "./scope";

/**
 * Who follows an Enrollment record besides its owners (Agent, Caller,
 * Responsible) — user decision 2026-10-24:
 *
 * - the Assistants of the record's Agent, as on the Task board ("wherever the
 *   Agent hears about a case, their Assistants do too", 2026-10-13);
 * - the people picked in the program's active custom Person columns (Follow
 *   up, Monitor, Medicare's Caller…), who can already see the record.
 *
 * They get every notification the owners get. At creation the people picked
 * in a Person column are assigned like the owners, while the Assistants get
 * "record created", as for a new task. Rows still go through the recipient
 * scope check, so nobody is told about a record they cannot open.
 */
export type EnrollmentWatcherContext = {
  assistantsByAgent: ReadonlyMap<string, readonly string[]>;
  personColumns: readonly ViewerPersonColumn[];
};

export type WatchedEnrollmentRecord = {
  program?: string | null;
  agent_email: string | null;
  custom_values?: Record<string, unknown> | null;
};

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/** One read of the Assistant roster and the Person columns, for a whole request or cron run. */
export async function loadEnrollmentWatcherContext(): Promise<EnrollmentWatcherContext> {
  const [assistantRows, personColumns] = await Promise.all([
    getSupabaseAdmin().from("agent_members").select("agent_email,cs_email").eq("is_assistant", true),
    fetchViewerPersonColumns(),
  ]);
  if (assistantRows.error) throw new Error(assistantRows.error.message);
  const assistantsByAgent = new Map<string, string[]>();
  for (const row of (assistantRows.data ?? []) as { agent_email: string; cs_email: string }[]) {
    const agent = normalize(row.agent_email);
    const assistant = normalize(row.cs_email);
    if (!agent || !assistant) continue;
    assistantsByAgent.set(agent, [...(assistantsByAgent.get(agent) ?? []), assistant]);
  }
  return { assistantsByAgent, personColumns };
}

export function agentAssistantEmails(
  record: WatchedEnrollmentRecord,
  context: EnrollmentWatcherContext,
): string[] {
  return [...(context.assistantsByAgent.get(normalize(record.agent_email)) ?? [])];
}

/** People picked in the record's program's custom Person columns, one entry per column. */
export function personColumnPicks(
  record: WatchedEnrollmentRecord,
  context: EnrollmentWatcherContext,
): Array<{ column: ViewerPersonColumn; emails: string[] }> {
  return context.personColumns
    .filter((column) => column.program === record.program)
    .map((column) => ({
      column,
      emails: personFieldEmails(record.custom_values?.[column.key]).map(normalize).filter(Boolean),
    }));
}

export function personColumnEmails(
  record: WatchedEnrollmentRecord,
  context: EnrollmentWatcherContext,
): string[] {
  return personColumnPicks(record, context).flatMap((pick) => pick.emails);
}

/** Assistants of the Agent plus the Person-column people: add these wherever the owners are notified. */
export function enrollmentWatcherEmails(
  record: WatchedEnrollmentRecord,
  context: EnrollmentWatcherContext,
): string[] {
  return [...new Set([...agentAssistantEmails(record, context), ...personColumnEmails(record, context)])];
}

/**
 * Who was newly picked in a Person column by an edit, with the column label so
 * the "assigned" notice can say where they were put.
 */
export function newPersonColumnPicks(
  before: WatchedEnrollmentRecord,
  after: WatchedEnrollmentRecord,
  context: EnrollmentWatcherContext,
): Array<{ email: string; label: string }> {
  const previous = new Map(
    personColumnPicks(before, context).map((pick) => [pick.column.key, new Set(pick.emails)]),
  );
  return personColumnPicks(after, context).flatMap((pick) =>
    pick.emails
      .filter((email) => !previous.get(pick.column.key)?.has(email))
      .map((email) => ({ email, label: pick.column.label ?? pick.column.key })),
  );
}

import {
  fetchAssistantAgentsForCs,
} from "@/lib/tasks/membership";
import { personalLeadAgentEmailsForWorker, type LeadActor } from "./access";
import { hasLeadCollaborator } from "./collaborators";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Lead membership reuses the task board's agent_members table rather than
 * introducing a second agent/assistant pairing. One org chart; two modules
 * reading it. Adding a private copy here is exactly how the two would drift.
 */

/**
 * Emails whose leads this actor may see and act on: their own, plus every agent
 * they are a promoted Assistant for. Returns null for a manager, meaning "no
 * owner filter at all" — an empty array would read as "nothing".
 *
 * fetchAssistantAgentsForCs throws on a query failure by design, so a broken
 * agent_members read fails the request instead of quietly narrowing (or, worse,
 * widening) what someone sees.
 */
export async function resolveLeadOwnerEmails(
  actor: LeadActor
): Promise<string[] | null> {
  if (actor.isManager) return null;
  const own = actor.email.trim().toLowerCase();
  const assisted = await fetchAssistantAgentsForCs(actor.email);
  return [...new Set([own, ...assisted.map((email) => email.trim().toLowerCase())])];
}

/**
 * Agents this worker may add a Personal lead for: themselves (when they are an
 * Agent) plus every Agent they are a promoted Assistant for. See
 * personalLeadAgentEmailsForWorker for the rule; this only fetches its inputs.
 *
 * Throws on a failed agent_members read rather than returning [] — an empty
 * answer means "may not add a lead", and a broken read must fail the request
 * instead of silently locking a real Agent out (or, worse, being mistaken for
 * a real answer).
 */
export async function resolveWorkerPersonalLeadAgentEmails(
  actor: LeadActor,
  rosterEmails: Iterable<string>,
): Promise<string[]> {
  const assistedAgentEmails = await fetchAssistantAgentsForCs(actor.email);
  return personalLeadAgentEmailsForWorker({
    actorEmail: actor.email,
    rosterEmails,
    assistedAgentEmails,
  });
}

/** True when the actor assists the Agent or any Collaborator on this lead. */
export async function isAssistantToLeadMember(
  assignedToEmail: string | null,
  collaboratorEmails: readonly string[] | null | undefined,
  actorEmail: string,
): Promise<boolean> {
  const actor = actorEmail.trim().toLowerCase();
  const members = [...new Set([
    assignedToEmail?.trim().toLowerCase() ?? "",
    ...(collaboratorEmails ?? []).map((email) => email.trim().toLowerCase()),
  ].filter(Boolean))];
  if (members.length === 0 || !actor) return false;
  if (hasLeadCollaborator(collaboratorEmails, actor)) return false;
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("agent_email")
    .in("agent_email", members)
    .eq("cs_email", actor)
    .eq("is_assistant", true)
    .limit(1);
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

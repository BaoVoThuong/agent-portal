import {
  fetchAssistantAgentsForCs,
  isAgentOwnerOrAssistant,
} from "@/lib/tasks/membership";
import type { LeadActor } from "./access";

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
 * Whether this actor is the lead's assigned agent or one of that agent's
 * Assistants. One row lookup, used by the per-lead routes.
 */
export async function isLeadOwnerOrAssistant(
  assignedToEmail: string | null,
  actorEmail: string
): Promise<boolean> {
  return isAgentOwnerOrAssistant(assignedToEmail, actorEmail);
}

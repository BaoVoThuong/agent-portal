import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";

export type AssignmentWeightRow = {
  event_id: string;
  agent_email: string;
  weight: number;
  current_weight: number;
  position: number;
  is_active: boolean;
};

export type AutoAssignOutcome = {
  assigned: number;
  unassigned: number;
  reason?: string;
};

export async function fetchAssignmentWeights(
  eventId: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<AssignmentWeightRow[]> {
  const { data, error } = await supabase
    .from("lead_event_assignment_weights")
    .select("event_id,agent_email,weight,current_weight,position,is_active")
    .eq("event_id", eventId)
    .order("position")
    .order("agent_email");
  if (error) throw new Error(error.message);
  return (data ?? []) as AssignmentWeightRow[];
}

export async function isAutoAssignEnabled(
  eventId: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<boolean> {
  const { data, error } = await supabase
    .from("lead_event_assignment_settings")
    .select("auto_assign_enabled")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.auto_assign_enabled);
}

export function eligibleAssignmentEmails(
  weights: readonly AssignmentWeightRow[],
  activeEmails: ReadonlySet<string>
): string[] {
  return weights
    .filter(
      (row) => row.is_active && row.weight > 0 && activeEmails.has(row.agent_email.trim().toLowerCase())
    )
    .map((row) => row.agent_email);
}

/** Assigns only the supplied Event's pool; other events have independent ratios and cursors. */
export async function autoAssignLeads(
  leadIds: readonly string[],
  eventId: string,
  actorEmail: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<AutoAssignOutcome> {
  if (leadIds.length === 0) return { assigned: 0, unassigned: 0 };

  const weights = await fetchAssignmentWeights(eventId, supabase);
  const configured = weights.filter((row) => row.is_active && row.weight > 0);
  if (configured.length === 0) {
    return { assigned: 0, unassigned: leadIds.length, reason: "No Agents are configured for this Event." };
  }

  const { data: accounts, error: accountError } = await supabase
    .from("portal_account")
    .select("email")
    .in("email", configured.map((row) => row.agent_email))
    .eq("is_active", true);
  if (accountError) throw new Error(accountError.message);
  const activeEmails = new Set(
    ((accounts ?? []) as { email: string }[]).map((row) => row.email.trim().toLowerCase())
  );
  const eligible = eligibleAssignmentEmails(weights, activeEmails);
  if (eligible.length === 0) {
    return {
      assigned: 0,
      unassigned: leadIds.length,
      reason: "Everyone configured for this Event has a deactivated account.",
    };
  }

  const { data, error } = await supabase.rpc("assign_leads_round_robin", {
    p_lead_ids: leadIds,
    p_event_id: eventId,
    p_eligible_emails: eligible,
    p_actor_email: actorEmail,
  });
  if (error) throw new Error(error.message);
  const assigned = Array.isArray(data) ? data.length : 0;
  return { assigned, unassigned: leadIds.length - assigned };
}

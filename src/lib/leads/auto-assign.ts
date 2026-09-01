import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canBeAssignedLead } from "./assign-target";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import type { LeadProduct } from "./types";

export type AssignmentWeightRow = {
  product: LeadProduct;
  agent_email: string;
  weight: number;
  current_weight: number;
  position: number;
  is_active: boolean;
};

export type AutoAssignOutcome = {
  assigned: number;
  unassigned: number;
  /** Why leads were left in the pool, when any were. */
  reason?: string;
};

/**
 * Which of the configured agents may actually receive a lead right now.
 *
 * The weight table is admin-curated data and drifts: it keeps a row for someone
 * who has since left, lost their role, or been deactivated. The rule for "can
 * this person take a lead" already exists in exactly one place, and this module
 * asks it rather than growing a fifth copy — the lead module has drifted four
 * times already from exactly that habit.
 */
export async function resolveEligibleAssignees(
  emails: readonly string[]
): Promise<string[]> {
  const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()))].filter(Boolean);
  const checks = await Promise.all(
    unique.map(async (email) => {
      const access = await getUserAccessByEmail(email);
      return canBeAssignedLead(access) ? email : null;
    })
  );
  return checks.filter((email): email is string => email !== null);
}

export async function fetchAssignmentWeights(
  product: LeadProduct,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<AssignmentWeightRow[]> {
  const { data, error } = await supabase
    .from("lead_assignment_weights")
    .select("product,agent_email,weight,current_weight,position,is_active")
    .eq("product", product)
    .order("position")
    .order("agent_email");
  if (error) throw new Error(error.message);
  return (data ?? []) as AssignmentWeightRow[];
}

export async function isAutoAssignEnabled(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<boolean> {
  const { data, error } = await supabase
    .from("lead_alert_settings")
    .select("auto_assign_enabled")
    .limit(1);
  // A missing column means the rollout has not run. Treat that as OFF rather
  // than failing the caller: auto-assign is an addition, not a prerequisite.
  if (error) return false;
  return Boolean((data ?? [])[0]?.auto_assign_enabled);
}

/**
 * Hand a batch of pool leads to agents by configured ratio.
 *
 * All the leads must share one product — the ratio table is per product, and
 * the rotation cursor with it. Callers holding a mixed batch group first.
 *
 * Never throws for "nobody is configured": those leads simply stay in the pool
 * and the outcome says why. Failing a 2,000-row import over a missing ratio
 * would be losing the big job to the small one.
 */
export async function autoAssignLeads(
  leadIds: readonly string[],
  product: LeadProduct,
  actorEmail: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<AutoAssignOutcome> {
  if (leadIds.length === 0) return { assigned: 0, unassigned: 0 };

  const weights = await fetchAssignmentWeights(product, supabase);
  const candidates = weights
    .filter((row) => row.is_active && row.weight > 0)
    .map((row) => row.agent_email);
  if (candidates.length === 0) {
    return {
      assigned: 0,
      unassigned: leadIds.length,
      reason: `No agent is set up to receive ${product === "pc" ? "P&C" : "Health"} leads.`,
    };
  }

  const eligible = await resolveEligibleAssignees(candidates);
  if (eligible.length === 0) {
    return {
      assigned: 0,
      unassigned: leadIds.length,
      reason:
        "Every agent in the distribution list has been deactivated or lost the lead permission.",
    };
  }

  const { data, error } = await supabase.rpc("assign_leads_round_robin", {
    p_lead_ids: leadIds,
    p_product: product,
    p_eligible_emails: eligible,
    p_actor_email: actorEmail,
  });
  if (error) throw new Error(error.message);
  const assigned = Array.isArray(data) ? data.length : 0;
  return { assigned, unassigned: leadIds.length - assigned };
}

/** Split a mixed batch so each product uses its own ratio and its own cursor. */
export function groupLeadIdsByProduct(
  leads: readonly { id: string; product: LeadProduct }[]
): Record<LeadProduct, string[]> {
  const grouped: Record<LeadProduct, string[]> = { pc: [], health: [] };
  for (const lead of leads) grouped[lead.product].push(lead.id);
  return grouped;
}

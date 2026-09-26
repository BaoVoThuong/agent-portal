import { cache } from "react";
import { fetchGrantHolders } from "@/lib/authz/holders";

export type LeadAssignee = { email: string; name: string | null };

/**
 * Active accounts that work leads (`lead.read` at any scope) — everyone a lead
 * may be handed to, and the only choices the assign control offers. Same rule
 * as canBeAssignedLead, so an account-role admin appears here too.
 */
export const fetchLeadAssignees = cache(async (): Promise<LeadAssignee[]> => {
  return (await fetchGrantHolders("lead.read"))
    .map((holder) => ({ email: holder.email, name: holder.name }))
    .sort((a, b) =>
      (a.name ?? a.email).localeCompare(b.name ?? b.email, undefined, {
        sensitivity: "base",
      })
    );
});

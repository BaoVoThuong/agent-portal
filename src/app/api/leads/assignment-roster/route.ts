import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  buildLeadActor,
  canManageLeads,
  isLeadViewAdmin,
} from "@/lib/leads/access";
import { fetchTaskAgents } from "@/lib/tasks/assignees";
import { LEAD_PRODUCTS, type LeadProduct } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * The agents a lead can be handed to, plus which products each one covers.
 *
 * The list is the registered agent roster — the `task_agents` table, read here
 * through `fetchTaskAgents()`, which is the exact function Config → Assistant
 * membership → Agents renders from. One roster, two screens, no second copy.
 *
 * Two tables were candidates and the wrong one was picked first: `agent_members`
 * holds agent↔assistant PAIRS, so reading its agent side only returns agents who
 * happen to have an assistant — 6 of the 17 on production. An agent with no
 * assistant is still an agent.
 *
 * Also deliberately not the lead-permission roster: who receives leads is
 * decided on the Distribute screen, and sourcing this from the permission table
 * would move that decision back into Role Manager.
 */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const [agents, weightsResult] = await Promise.all([
    // Already filtered to active accounts and enriched with names.
    fetchTaskAgents(),
    supabase.from("lead_assignment_weights").select("product,agent_email"),
  ]);
  if (weightsResult.error) {
    return NextResponse.json({ error: weightsResult.error.message }, { status: 500 });
  }

  const assignedTo = new Map<string, Set<LeadProduct>>();
  for (const row of (weightsResult.data ?? []) as {
    product: LeadProduct;
    agent_email: string;
  }[]) {
    const key = row.agent_email.trim().toLowerCase();
    const set = assignedTo.get(key) ?? new Set<LeadProduct>();
    set.add(row.product);
    assignedTo.set(key, set);
  }

  return NextResponse.json({
    agents: agents
      .map((agent) => {
        const key = agent.email.trim().toLowerCase();
        return {
          email: key,
          name: agent.name,
          products: LEAD_PRODUCTS.filter((product) =>
            assignedTo.get(key)?.has(product)
          ),
        };
      })
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
  });
}

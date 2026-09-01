import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  buildLeadActor,
  canManageLeads,
  isLeadViewAdmin,
} from "@/lib/leads/access";
import { LEAD_PRODUCTS, type LeadProduct } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * The agents a lead can be handed to, plus which products each one currently
 * covers.
 *
 * The list is the AGENT side of Assistant membership (`agent_members.agent_email`),
 * not the assistant side: an assistant supports an agent's work but is not who a
 * lead belongs to. One org chart, read here rather than copied.
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
  const [membersResult, accountsResult, weightsResult] = await Promise.all([
    supabase.from("agent_members").select("agent_email").eq("is_assistant", true),
    supabase.from("portal_account").select("email,name").eq("is_active", true),
    supabase.from("lead_assignment_weights").select("product,agent_email"),
  ]);
  if (membersResult.error) {
    return NextResponse.json({ error: membersResult.error.message }, { status: 500 });
  }
  if (accountsResult.error) {
    return NextResponse.json({ error: accountsResult.error.message }, { status: 500 });
  }
  if (weightsResult.error) {
    return NextResponse.json({ error: weightsResult.error.message }, { status: 500 });
  }

  const nameByEmail = new Map(
    ((accountsResult.data ?? []) as { email: string; name: string | null }[]).map(
      (row) => [row.email.trim().toLowerCase(), row.name]
    )
  );

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

  const agentEmails = [
    ...new Set(
      ((membersResult.data ?? []) as { agent_email: string }[])
        .map((row) => row.agent_email.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
    // Only agents with a live account: a row left behind for someone who has
    // gone would otherwise sit in the picker forever with no way to tell.
    .filter((agentEmail) => nameByEmail.has(agentEmail))
    .sort();

  return NextResponse.json({
    agents: agentEmails.map((agentEmail) => ({
      email: agentEmail,
      name: nameByEmail.get(agentEmail) ?? null,
      products: LEAD_PRODUCTS.filter((product) =>
        assignedTo.get(agentEmail)?.has(product)
      ),
    })),
  });
}

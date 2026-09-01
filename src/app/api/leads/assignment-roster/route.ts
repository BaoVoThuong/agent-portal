import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  buildLeadActor,
  canManageLeads,
  isLeadViewAdmin,
} from "@/lib/leads/access";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Every active account, for the "add agent" picker on the Distribute screen.
 *
 * Deliberately NOT fetchLeadAssignees(), which filters by lead permission: who
 * receives leads is decided by the distribution list itself, so sourcing this
 * picker from the permission table would put that decision back in Role Manager
 * — the opposite of what the screen is for.
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

  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email,name")
    .eq("is_active", true)
    .order("email");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    accounts: (data ?? []).map((row) => {
      const account = row as { email: string; name: string | null };
      return { email: account.email.toLowerCase(), name: account.name };
    }),
  });
}

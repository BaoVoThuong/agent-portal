import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  buildLeadActor,
  canManageLeads,
  isLeadViewAdmin,
} from "@/lib/leads/access";
import {
  autoAssignLeads,
  groupLeadIdsByProduct,
} from "@/lib/leads/auto-assign";
import {
  broadcastLeadsChanged,
  readLeadMutationSourceId,
} from "@/lib/leads/realtime";
import { LEAD_PRODUCTS, type LeadProduct } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * One press distributes at most this many. A cap keeps the request inside its
 * time budget and, more importantly, keeps a mistake small: getting back 500
 * wrongly-assigned leads is recoverable, 20,000 is not.
 */
const MAX_PER_RUN = 500;

type PoolRow = { id: string; product: LeadProduct };

async function fetchPool(
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<{ rows: PoolRow[]; remaining: number }> {
  const { data, error, count } = await supabase
    .from("leads")
    .select("id,product", { count: "exact" })
    .is("assigned_to_email", null)
    .is("archived_at", null)
    // Oldest first: a lead nobody has touched for a week deserves an agent
    // before one that arrived this morning.
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PoolRow[];
  return { rows, remaining: Math.max((count ?? rows.length) - rows.length, 0) };
}

/** GET previews what a run would do, so the confirmation can state real numbers. */
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

  const { rows, remaining } = await fetchPool(getSupabaseAdmin());
  const grouped = groupLeadIdsByProduct(rows);
  return NextResponse.json({
    pending: rows.length,
    remaining,
    byProduct: { pc: grouped.pc.length, health: grouped.health.length },
  });
}

export async function POST(request: Request) {
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
  const actorEmail = actor.email.trim().toLowerCase();
  const { rows, remaining } = await fetchPool(supabase);
  if (rows.length === 0) {
    return NextResponse.json({ assigned: 0, unassigned: 0, remaining: 0, results: {} });
  }

  // Each product carries its own ratio AND its own rotation cursor, so a mixed
  // batch has to be split before either is touched.
  const grouped = groupLeadIdsByProduct(rows);
  const results: Record<string, { assigned: number; unassigned: number; reason?: string }> = {};
  let assigned = 0;
  let unassigned = 0;

  for (const product of LEAD_PRODUCTS) {
    const ids = grouped[product];
    if (ids.length === 0) continue;
    // Deliberately sequential: two concurrent calls would contend on the same
    // locked weight rows, and one product finishing late is not worth it.
    const outcome = await autoAssignLeads(ids, product, actorEmail, supabase);
    results[product] = outcome;
    assigned += outcome.assigned;
    unassigned += outcome.unassigned;
  }

  if (assigned > 0) {
    const sourceId = readLeadMutationSourceId(request);
    after(async () => {
      await broadcastLeadsChanged(sourceId);
    });
  }
  return NextResponse.json({ assigned, unassigned, remaining, results });
}

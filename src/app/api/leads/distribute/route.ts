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
import { isLeadProduct, LEAD_PRODUCTS, type LeadProduct } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * One press distributes at most this many. A cap keeps the request inside its
 * time budget and, more importantly, keeps a mistake small: getting back 500
 * wrongly-assigned leads is recoverable, 20,000 is not.
 */
const MAX_PER_RUN = 500;

type PoolRow = {
  id: string;
  product: LeadProduct | null;
  products: LeadProduct[] | null;
};

async function fetchPool(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  /** null = mọi product. Nút Distribute đứng dưới một tab product thì chỉ chia
   *  product đó — nó nói "Distribute 4" trong khi cả 4 lead là của product kia
   *  là dối, và bấm vào thì chia mất lead của tab khác. */
  product: LeadProduct | null = null
): Promise<{ rows: PoolRow[]; remaining: number }> {
  let query = supabase
    .from("leads")
    .select("id,product,products", { count: "exact" })
    .is("assigned_to_email", null)
    .is("archived_at", null)
    // Oldest first: a lead nobody has touched for a week deserves an agent
    // before one that arrived this morning.
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  // `@>` trên mảng, không phải `=` trên cột scalar: một lead mang cả hai product
  // có `product = "pc"` (trigger lấy phần tử đầu), nên lọc bằng cột cũ là tab
  // Health không bao giờ thấy nó — trong khi luật là lead nằm trong pool của MỌI
  // product nó mang.
  if (product) query = query.contains("products", [product]);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PoolRow[];
  return { rows, remaining: Math.max((count ?? rows.length) - rows.length, 0) };
}

/** GET previews what a run would do, so the confirmation can state real numbers. */
export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Không truyền product thì trả cả pool — phần tóm tắt đầu dialog cần con số
  // tổng, còn nút Distribute hỏi riêng theo tab của nó.
  const raw = new URL(request.url).searchParams.get("product");
  const product = isLeadProduct(raw) ? raw : null;
  const { rows, remaining } = await fetchPool(getSupabaseAdmin(), product);
  const grouped = groupLeadIdsByProduct(rows, product);
  return NextResponse.json({
    product,
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
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const product = isLeadProduct(body?.product) ? body.product : null;
  const { rows, remaining } = await fetchPool(supabase, product);
  if (rows.length === 0) {
    return NextResponse.json({ assigned: 0, unassigned: 0, remaining: 0, results: {} });
  }

  // Each product carries its own ratio AND its own rotation cursor, so a mixed
  // batch has to be split before either is touched.
  const grouped = groupLeadIdsByProduct(rows, product);
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

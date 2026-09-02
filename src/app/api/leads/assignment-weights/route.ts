import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  buildLeadActor,
  canManageLeads,
  canWorkLeads,
  isLeadViewAdmin,
} from "@/lib/leads/access";
import {
  fetchAssignmentWeights,
  isAutoAssignEnabled,
} from "@/lib/leads/auto-assign";
import { pickWeighted, previewDistribution } from "@/lib/leads/round-robin";
import { isLeadProduct, type LeadProduct } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** How far ahead the preview looks. Ten is what people can hold in their head. */
const PREVIEW_SIZE = 10;

/**
 * GET is deliberately open to any lead worker, not just a manager: the import
 * dialog shows the split before someone commits 2,000 rows to it, and the
 * person importing is not always the person who set the ratio.
 */
export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canWorkLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rawProduct = new URL(request.url).searchParams.get("product");
  if (!isLeadProduct(rawProduct)) {
    return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  }
  const product: LeadProduct = rawProduct;

  const supabase = getSupabaseAdmin();
  const [rows, enabled] = await Promise.all([
    fetchAssignmentWeights(product, supabase),
    isAutoAssignEnabled(product, supabase),
  ]);

  // Rows the admin has switched on. That list alone decides who receives
  // leads — see autoAssignLeads for why RBAC does not get a second vote.
  const usable = rows.filter((row) => row.is_active && row.weight > 0);
  const totalWeight = usable.reduce((sum, row) => sum + row.weight, 0);
  const entries = usable.map((row) => ({
    email: row.agent_email,
    weight: row.weight,
    currentWeight: row.current_weight,
    position: row.position,
  }));
  return NextResponse.json({
    product,
    enabled,
    weights: rows.map((row) => ({
      agent_email: row.agent_email,
      weight: row.weight,
      position: row.position,
      is_active: row.is_active,
      // Con trỏ xoay vòng đi kèm để màn hình dựng lại được dãy kế tiếp ngay khi
      // người ta gõ trọng số mới, mà vẫn xuất phát từ tình trạng chia hiện tại
      // — lead trước đó chưa bao giờ chia đều tuyệt đối.
      current_weight: row.current_weight,
      /** Computed, never stored: storing percentages forces them to sum to 100. */
      share: totalWeight > 0 && row.is_active && row.weight > 0
        ? Math.round((row.weight / totalWeight) * 1000) / 10
        : 0,
    })),
    preview: previewDistribution(entries, PREVIEW_SIZE),
    // Thứ tự thật của N lượt kế tiếp, không phải chỉ số đếm. "A 7 · B 3" nói
    // được tỉ lệ nhưng không nói được ai nhận lead ngay sau đây — mà đó mới là
    // câu người đứng trước nút Distribute đang hỏi.
    sequence: pickWeighted(entries, PREVIEW_SIZE).picks,
  });
}

type WeightInput = {
  agent_email: string;
  weight: number;
  position: number;
  is_active: boolean;
};

function parseWeights(value: unknown): WeightInput[] | { error: string } {
  if (!Array.isArray(value)) return { error: "weights must be a list." };
  const parsed: WeightInput[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return { error: "Each weight must be an object." };
    const row = raw as Record<string, unknown>;
    const agentEmail = typeof row.agent_email === "string" ? row.agent_email.trim().toLowerCase() : "";
    if (!agentEmail) return { error: "Each weight needs an agent." };
    if (seen.has(agentEmail)) return { error: `${agentEmail} is listed twice.` };
    seen.add(agentEmail);
    const weight = Number(row.weight);
    if (!Number.isInteger(weight) || weight < 0) {
      return { error: `Weight for ${agentEmail} must be a whole number of 0 or more.` };
    }
    const position = Number.isInteger(Number(row.position)) ? Number(row.position) : 0;
    parsed.push({
      agent_email: agentEmail,
      weight,
      position,
      is_active: row.is_active !== false,
    });
  }
  return parsed;
}

/**
 * Replaces the whole list for one product in one call.
 *
 * Not a per-row PATCH on purpose: a ratio is a relationship BETWEEN rows, so
 * editing one row alone is never what the admin means. Sending the list whole
 * also makes a removal expressible, which a per-row endpoint cannot do.
 */
export async function PUT(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isLeadProduct(body?.product)) {
    return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  }
  const product: LeadProduct = body.product;
  const parsed = parseWeights(body?.weights);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // Một giao dịch. Trước đó là bốn bước rời (đọc -> xoá agent bị bỏ -> upsert
  // phần còn lại -> cập nhật cờ), nên một bước hỏng giữa chừng để lại cấu hình
  // NỬA VỜI: agent đã xoá mà trọng số mới chưa ghi. Đây là bảng quyết định lead
  // của ai, nên nửa vời ở đây nghĩa là chia lead sai cho tới khi có người phát
  // hiện. RPC còn khoá mọi dòng của product trước khi đụng vào gì, nên hai admin
  // lưu cùng lúc thì người thứ hai CHỜ thay vì ghi đè lên nửa chừng.
  const { error } = await getSupabaseAdmin().rpc("save_lead_assignment_weights", {
    p_product: product,
    p_rows: parsed,
    p_enabled: typeof body?.enabled === "boolean" ? body.enabled : null,
    p_actor_email: actor.email,
  });
  if (error) {
    if (error.message.includes("LEAD_ACTOR_REQUIRED")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error.message.includes("LEAD_PRODUCT_INVALID")) {
      return NextResponse.json({ error: "Unknown product." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * Bật/tắt MỘT agent cho MỘT product.
 *
 * Riêng ra khỏi PUT vì đây là thao tác một dòng: màn Agent config trước đây
 * phải GET cả danh sách, PUT lại cả danh sách, rồi GET lần nữa — ba vòng mạng
 * cho một cú tick, và cả bảng bị khoá suốt thời gian đó.
 *
 * KHÔNG xoá dòng khi tắt và không đụng `weight`/`current_weight`: người nghỉ
 * phép quay lại phải về đúng chỗ cũ với đúng tỉ lệ cũ.
 */
export async function PATCH(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isLeadProduct(body?.product)) {
    return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  }
  const agentEmail =
    typeof body?.agent_email === "string" ? body.agent_email.trim().toLowerCase() : "";
  if (!agentEmail) {
    return NextResponse.json({ error: "An agent is required." }, { status: 400 });
  }
  if (typeof body?.is_active !== "boolean") {
    return NextResponse.json({ error: "is_active must be true or false." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const actorEmail = actor.email.trim().toLowerCase();
  const nowIso = new Date().toISOString();

  const { data: existing, error: readError } = await supabase
    .from("lead_assignment_weights")
    .select("agent_email")
    .eq("product", body.product)
    .eq("agent_email", agentEmail)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  if (existing) {
    const { error } = await supabase
      .from("lead_assignment_weights")
      .update({ is_active: body.is_active, updated_by_email: actorEmail, updated_at: nowIso })
      .eq("product", body.product)
      .eq("agent_email", agentEmail);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (body.is_active) {
    // Người mới: trọng số 1 để họ có mặt trong vòng xoay ngay, admin chỉnh sau
    // ở tab product.
    const { count } = await supabase
      .from("lead_assignment_weights")
      .select("agent_email", { count: "exact", head: true })
      .eq("product", body.product);
    const { error } = await supabase.from("lead_assignment_weights").insert({
      product: body.product,
      agent_email: agentEmail,
      weight: 1,
      position: (count ?? 0) + 1,
      is_active: true,
      updated_by_email: actorEmail,
      updated_at: nowIso,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Zero the rotation cursor for one product.
 *
 * Its own endpoint rather than a field on PUT: it throws away the part-finished
 * cycle, which is a different act from changing the ratio and deserves its own
 * confirmation.
 */
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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.action !== "reset_cursor" || !isLeadProduct(body?.product)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin()
    .from("lead_assignment_weights")
    .update({ current_weight: 0, updated_at: new Date().toISOString() })
    .eq("product", body.product);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

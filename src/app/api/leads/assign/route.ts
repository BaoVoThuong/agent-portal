import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { canBeAssignedLead } from "@/lib/leads/assign-target";
import { validateAssignRequest } from "@/lib/leads/assign";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import type { LeadRow } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const LEAD_AFTER_SELECT =
  "id,display_number,product,products,event_id,full_name,phone,email," +
  "assigned_to_email,assigned_at,assigned_by_email,status_id," +
  "first_contacted_at,last_contacted_at,contact_attempt_count," +
  "next_follow_up_at,closed_at,created_by_email,created_at," +
  "updated_by_email,updated_at,custom_values,archived_at,lead_events(name)";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = validateAssignRequest(
    (await request.json().catch(() => null)) as Record<string, unknown> | null
  );
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (parsed.toEmail) {
    const targetAccess = await getUserAccessByEmail(parsed.toEmail);
    if (!canBeAssignedLead(targetAccess)) {
      return NextResponse.json({ error: "That person cannot be assigned leads." }, { status: 400 });
    }
  }

  const supabase = getSupabaseAdmin();
  // Một giao dịch: gán và ghi lịch sử cùng nhau. Trước đó là ba truy vấn rời và
  // lỗi ở bước ghi lịch sử chỉ được console.error, nên lead đổi chủ mà bảng
  // lịch sử trống — mà đó là bảng duy nhất trả lời được "ai giao việc này".
  // RPC còn đọc chủ cũ DƯỚI KHOÁ, nên ai gán chen vào giữa cũng không làm lịch
  // sử ghi sai người chủ cũ.
  const { data: assignedRows, error: assignError } = await supabase.rpc(
    "assign_leads_manual",
    {
      p_lead_ids: parsed.leadIds,
      p_to_email: parsed.toEmail,
      p_actor_email: actor.email,
      p_reason: parsed.reason,
    }
  );
  if (assignError) {
    if (assignError.message.includes("LEAD_ACTOR_REQUIRED")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: assignError.message }, { status: 500 });
  }
  const assignedIds = ((assignedRows ?? []) as { lead_id: string }[]).map(
    (row) => row.lead_id
  );
  if (assignedIds.length === 0) {
    return NextResponse.json({ error: "No active leads were found." }, { status: 404 });
  }

  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId, assignedIds); });
  // Trả về chính những dòng vừa đổi để màn hình vá tại chỗ. Trước đây chỉ trả
  // số lượng, nên gán MỘT lead cũng buộc client kéo lại toàn bộ danh sách.
  const { data: updated, error: afterError } = await supabase
    .from("leads")
    .select(LEAD_AFTER_SELECT)
    .in("id", assignedIds);
  if (afterError) return NextResponse.json({ error: afterError.message }, { status: 500 });
  return NextResponse.json({
    assigned: assignedIds.length,
    leads: (updated ?? []).map((row) => {
      const lead = row as unknown as LeadRow & {
        lead_events?: { name?: string | null } | null;
      };
      const { lead_events, ...rest } = lead;
      return { ...rest, event_name: lead_events?.name?.trim() || null };
    }),
  });
}

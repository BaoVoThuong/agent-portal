import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, canWorkLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import { resolveEventByName } from "@/lib/leads/events";
import { getSupabaseAdmin } from "@/lib/supabase";

const EVENT_PAGE_SIZE = 200;

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canWorkLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Lấy dư một dòng để biết còn nữa hay không. Trước đây cắt cứng ở 200 mà
  // không nói gì, nên sự kiện thứ 201 trở đi biến mất khỏi cả hai dialog và
  // người dùng không có cách nào biết danh sách đã bị cắt.
  const { data, error } = await getSupabaseAdmin()
    .from("lead_events")
    .select("id,name,event_date")
    .is("archived_at", null)
    .order("event_date", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(EVENT_PAGE_SIZE + 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];
  const truncated = rows.length > EVENT_PAGE_SIZE;
  return NextResponse.json({
    events: truncated ? rows.slice(0, EVENT_PAGE_SIZE) : rows,
    truncated,
  });
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "The event needs a name." }, { status: 400 });
  if (name.length > 200) return NextResponse.json({ error: "The event name is too long." }, { status: 400 });
  const rawEventDate = body?.event_date;
  const parsedEventDate = typeof rawEventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawEventDate)
    ? new Date(`${rawEventDate}T00:00:00Z`)
    : null;
  if (rawEventDate !== undefined && rawEventDate !== null && rawEventDate !== "" &&
      (!parsedEventDate || !Number.isFinite(parsedEventDate.getTime()) ||
        parsedEventDate.toISOString().slice(0, 10) !== rawEventDate)) {
    return NextResponse.json({ error: "event_date must be a valid date." }, { status: 400 });
  }
  const eventDate = typeof rawEventDate === "string" && rawEventDate !== "" ? rawEventDate : null;

  const supabase = getSupabaseAdmin();
  // Cùng một hàm find-or-create mà đường tạo lead dùng. Trước đây route này
  // insert thẳng, nên trùng tên trả về lỗi 23505 thô dưới dạng 500 — trong khi
  // ở màn tạo lead thì đúng cái tên đó lại resolve về sự kiện đã có. Một khái
  // niệm, hai hành vi.
  const resolved = await resolveEventByName(supabase, name, actor.email.trim().toLowerCase());
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });

  // Chỉ điền các trường phụ cho sự kiện vừa được tạo. Ghi đè lên một sự kiện
  // đang tồn tại là sửa dữ liệu người khác nhập, không phải "tạo".
  if (resolved.wasCreated && (eventDate || body?.location || body?.notes)) {
    await supabase
      .from("lead_events")
      .update({
        event_date: eventDate,
        location: typeof body?.location === "string" ? body.location.trim() || null : null,
        notes: typeof body?.notes === "string" ? body.notes.trim() || null : null,
      })
      .eq("id", resolved.id);
  }

  const { data, error } = await supabase
    .from("lead_events")
    .select("id,name,event_date,location,notes,created_at")
    .eq("id", resolved.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Một sự kiện mới không đổi dòng lead nào, nên không cần bắt mọi tab tải lại
  // toàn bộ danh sách. Dialog tự thêm vào danh sách của nó từ response.
  if (resolved.wasCreated) {
    const sourceId = readLeadMutationSourceId(request);
    after(async () => { await broadcastLeadsChanged(sourceId); });
  }
  return NextResponse.json({ event: data, wasCreated: resolved.wasCreated });
}

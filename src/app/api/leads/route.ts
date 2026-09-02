import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, canWorkLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { parseCreateLeadInput } from "@/lib/leads/create";
import { fetchAllLeads } from "@/lib/leads/queries";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canBeAssignedLead } from "@/lib/leads/assign-target";
import { resolveEventByName } from "@/lib/leads/events";
import { resolveLeadOwnerEmails } from "@/lib/leads/membership";
import { findMissingRequiredFields } from "@/lib/table-config/required";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canWorkLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const ownerEmails = await resolveLeadOwnerEmails(actor);

  // ?ids=a,b,c đi qua ĐÚNG bộ lọc phạm vi như mọi truy vấn khác — nó chỉ thêm
  // một mệnh đề `in (id)`, không phải một đường tắt. Realtime dùng nó để vá vài
  // dòng thay vì kéo lại cả danh sách.
  const { rows, total } = await fetchAllLeads(
    actor,
    params,
    undefined,
    ownerEmails,
  );
  return NextResponse.json({
    leads: rows,
    total,
  });
}

const LEAD_COLUMNS =
  "id,display_number,product,products,event_id,full_name,phone,email," +
  "assigned_to_email,assigned_at,assigned_by_email,status_id," +
  "first_contacted_at,last_contacted_at,contact_attempt_count," +
  "next_follow_up_at,closed_at,created_by_email,created_at," +
  "updated_by_email,updated_at,custom_values,archived_at";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = parseCreateLeadInput(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;
  const supabase = getSupabaseAdmin();

  if (input.clientRequestId) {
    const { data: existing, error: existingError } = await supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("client_request_id", input.clientRequestId)
      // Token do client sinh. Không giới hạn theo người tạo thì hai người vô
      // tình trùng token sẽ nhận về lead CỦA NGƯỜI KHÁC.
      .eq("created_by_email", actor.email.trim().toLowerCase())
      .limit(1);
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
    if (existing?.[0]) return NextResponse.json({ lead: existing[0], wasCreated: false });
  }

  // Event is typed, not chosen from a closed list, so that adding a lead never
  // waits on someone registering the event first. Leads still point at a real
  // lead_events row, which is what keeps the per-event report meaningful — the
  // name is matched case- and space-insensitively so "Health Fair" typed twice
  // does not become two events in that report.
  let eventId = input.eventId;
  if (eventId) {
    const { data: event, error: eventError } = await supabase
      .from("lead_events")
      .select("id")
      .eq("id", eventId)
      .is("archived_at", null)
      .maybeSingle();
    if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });
    if (!event) return NextResponse.json({ error: "That event is no longer available." }, { status: 400 });
  } else if (input.eventName) {
    const resolved = await resolveEventByName(
      supabase,
      input.eventName,
      actor.email.trim().toLowerCase()
    );
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 500 });
    eventId = resolved.id;
  }

  let statusId = input.statusId;
  if (statusId) {
    const { data: status, error: statusError } = await supabase
      .from("lead_statuses")
      .select("id")
      .eq("id", statusId)
      .is("archived_at", null)
      .maybeSingle();
    if (statusError) return NextResponse.json({ error: statusError.message }, { status: 500 });
    if (!status) return NextResponse.json({ error: "That status no longer exists." }, { status: 400 });
  } else {
    const { data: defaultStatus, error: defaultStatusError } = await supabase
      .from("lead_statuses")
      .select("id")
      .eq("kind", "open")
      .is("archived_at", null)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (defaultStatusError) return NextResponse.json({ error: defaultStatusError.message }, { status: 500 });
    statusId = defaultStatus?.id ?? null;
  }

  const missingRequired = await findMissingRequiredFields(
    "lead",
    {
      fieldValues: {
        name: input.fullName,
        phone: input.phone,
        email: input.email,
        assignee: input.assignedToEmail,
        status: statusId,
      },
      customValues: input.customValues,
    },
    supabase
  );
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: `${missingRequired.map((field) => field.label).join(", ")} required.` },
      { status: 400 }
    );
  }

  if (input.assignedToEmail) {
    const targetAccess = await getUserAccessByEmail(input.assignedToEmail);
    if (!canBeAssignedLead(targetAccess)) {
      return NextResponse.json({ error: "That person cannot be assigned leads." }, { status: 400 });
    }
  }

  let duplicateQuery = supabase
    .from("leads")
    .select("id")
    .eq("phone", input.phone)
    .is("archived_at", null)
    .limit(1);
  duplicateQuery = eventId
    ? duplicateQuery.eq("event_id", eventId)
    : duplicateQuery.is("event_id", null);
  const { data: duplicate, error: duplicateError } = await duplicateQuery;
  if (duplicateError) return NextResponse.json({ error: duplicateError.message }, { status: 500 });
  if (duplicate?.[0]) {
    return NextResponse.json(
      { error: "A lead with this phone number already exists for that event." },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  const normalizedActorEmail = actor.email.trim().toLowerCase();
  const { data: lead, error: insertError } = await supabase
    .from("leads")
    .insert({
      product: input.product,
      products: [input.product],
      event_id: eventId,
      full_name: input.fullName,
      phone: input.phone,
      email: input.email,
      // Cố ý insert CHƯA GÁN, kể cả khi người dùng đã chọn người nhận. Việc gán
      // đi qua assign_leads_manual ngay bên dưới, để nó và dòng lịch sử nằm
      // trong cùng một giao dịch. Set sẵn ở đây thì RPC sẽ đọc chính người đó
      // làm "chủ cũ" và ghi lịch sử "từ X sang X".
      assigned_to_email: null,
      assigned_at: null,
      assigned_by_email: null,
      status_id: statusId,
      custom_values: input.customValues,
      created_by_email: normalizedActorEmail,
      updated_by_email: normalizedActorEmail,
      updated_at: nowIso,
      client_request_id: input.clientRequestId,
    })
    .select(LEAD_COLUMNS)
    .single();
  if (insertError) {
    // 23505 = unique_violation. Ba index có thể chạm tới ở đây và mỗi cái nói
    // một chuyện khác nhau — trả 500 cho cả ba là bắt người dùng đoán.
    if (insertError.code === "23505") {
      if (insertError.message.includes("leads_creator_request_unique_idx")) {
        // Cùng token, cùng người: đây là một lượt gửi lại. Trả về lead đã có
        // thay vì báo lỗi — đó chính là điều idempotency hứa hẹn.
        const { data: existing } = await supabase
          .from("leads")
          .select(LEAD_COLUMNS)
          .eq("client_request_id", input.clientRequestId)
          .eq("created_by_email", normalizedActorEmail)
          .maybeSingle();
        if (existing) return NextResponse.json({ lead: existing, wasCreated: false });
      }
      return NextResponse.json(
        { error: "A lead with this phone number already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  const createdLead = lead as unknown as { id: string };

  let finalLead = lead;
  if (input.assignedToEmail) {
    // Cùng RPC với đường gán tay: gán và ghi lịch sử trong một giao dịch. Trước
    // đó lỗi ghi lịch sử chỉ được console.error, nên lead tạo ra đã có chủ mà
    // bảng lịch sử trống.
    const { error: assignError } = await supabase.rpc("assign_leads_manual", {
      p_lead_ids: [createdLead.id],
      p_to_email: input.assignedToEmail,
      p_actor_email: normalizedActorEmail,
      p_reason: "Assigned when lead was created",
    });
    if (assignError) {
      // Lead đã tồn tại và CHƯA gán — trạng thái hợp lệ, nhìn thấy được trên
      // màn hình, sửa bằng một cú bấm. Nói thật còn hơn trả về "đã gán" rồi để
      // bảng lịch sử nói ngược lại.
      return NextResponse.json(
        {
          error: "The lead was created but could not be assigned. Assign it from the list.",
          lead,
        },
        { status: 500 }
      );
    }
    // Đọc lại để phản hồi mang đúng người nhận: bản `lead` ở trên chụp lúc chưa gán.
    const { data: reread } = await supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("id", createdLead.id)
      .maybeSingle();
    if (reread) finalLead = reread;
  }

  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId); });
  return NextResponse.json({ lead: finalLead, wasCreated: true }, { status: 201 });
}

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
  "id,display_number,product,event_id,full_name,phone,email," +
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
      event_id: eventId,
      full_name: input.fullName,
      phone: input.phone,
      email: input.email,
      assigned_to_email: input.assignedToEmail,
      assigned_at: input.assignedToEmail ? nowIso : null,
      assigned_by_email: input.assignedToEmail ? normalizedActorEmail : null,
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
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "A lead with this phone number already exists for that event." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  const createdLead = lead as unknown as { id: string };

  if (input.assignedToEmail) {
    const { error: historyError } = await supabase
      .from("lead_assignment_history")
      .insert({
        lead_id: createdLead.id,
        from_email: null,
        to_email: input.assignedToEmail,
        reason: "Assigned when lead was created",
        actor_email: normalizedActorEmail,
      });
    if (historyError) console.error("Lead assignment history insert failed", historyError.message);
  }

  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId); });
  return NextResponse.json({ lead, wasCreated: true }, { status: 201 });
}

import { NextResponse } from "next/server";
import { getTimeOffActor } from "@/lib/time-off/access";
import { getSupabaseAdmin } from "@/lib/supabase";

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function note(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= 1_000 ? trimmed || null : null;
}

/** Approve, reject, or cancel one leave request with actor-specific rules. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const actor = await getTimeOffActor();
  if (!actor) return responseError("Unauthorized", 401);
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return responseError("Invalid request id.");
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action !== "approve" && action !== "reject" && action !== "cancel") {
    return responseError("Unknown time-off action.");
  }
  const reviewerNote = note(body?.note);
  if (typeof body?.note === "string" && body.note.trim().length > 1_000) {
    return responseError("Note must be 1,000 characters or fewer.");
  }

  const supabase = getSupabaseAdmin();
  const { data: requestRow, error: loadError } = await supabase
    .from("time_off_requests")
    .select("id,requester_id,status")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return responseError(loadError.message, 500);
  if (!requestRow) return responseError("Time-off request not found.", 404);
  const row = requestRow as { id: string; requester_id: string; status: string };
  if (row.status !== "pending") return responseError("This request has already been decided.", 409);

  if (action === "cancel") {
    if (row.requester_id !== actor.accountId) return responseError("You can only cancel your own request.", 403);
    const { data, error } = await supabase
      .from("time_off_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .select("id,status")
      .maybeSingle();
    if (error) return responseError(error.message, 500);
    if (!data) return responseError("This request was changed by someone else. Refresh and try again.", 409);
    return NextResponse.json({ request: data });
  }

  if (!actor.canManage) return responseError("Time Off Admin permission is required to review time off.", 403);
  if (row.requester_id === actor.accountId) {
    return responseError("You cannot review your own time-off request.", 403);
  }
  if (action === "approve") {
    const { data, error } = await supabase.rpc("approve_time_off_request", {
      p_request_id: id,
      p_reviewer_id: actor.accountId,
      p_reviewer_note: reviewerNote,
    });
    if (error) {
      const message = error.message.includes("TIME_OFF_")
        ? error.message.replace(/^.*?(TIME_OFF_[A-Z_]+).*$/, "$1").replace(/_/g, " ").toLowerCase()
        : error.message;
      return responseError(message, error.message.includes("BALANCE") ? 409 : 400);
    }
    return NextResponse.json({ request: data });
  }

  const { data, error } = await supabase
    .from("time_off_requests")
    .update({
      status: "rejected",
      reviewer_id: actor.accountId,
      reviewer_note: reviewerNote,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id,status")
    .maybeSingle();
  if (error) return responseError(error.message, 500);
  if (!data) return responseError("This request was changed by someone else. Refresh and try again.", 409);
  return NextResponse.json({ request: data });
}

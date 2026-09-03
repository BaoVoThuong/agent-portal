import { NextResponse } from "next/server";
import { getTimeOffActor } from "@/lib/time-off/access";
import { getSupabaseAdmin } from "@/lib/supabase";

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function approvalError(message: string) {
  const code = message.match(/TIME_OFF_[A-Z_]+/)?.[0];
  switch (code) {
    case "TIME_OFF_INSUFFICIENT_BALANCE":
      return { message: "This request exceeds the employee’s available leave balance.", status: 409 };
    case "TIME_OFF_REQUEST_ALREADY_DECIDED":
      return { message: "This request has already been decided. Refresh and try again.", status: 409 };
    case "TIME_OFF_POLICY_NOT_FOUND":
      return { message: "This leave type is no longer active, so the request cannot be approved.", status: 409 };
    case "TIME_OFF_SELF_APPROVAL_FORBIDDEN":
      return { message: "You cannot approve your own time-off request.", status: 403 };
    case "TIME_OFF_REQUEST_NOT_FOUND":
      return { message: "Time-off request not found.", status: 404 };
    default:
      return { message: "Approval could not be completed. Please try again or contact an administrator.", status: 400 };
  }
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
      console.error("Time-off approval failed", {
        requestId: id,
        reviewerId: actor.accountId,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      const failure = approvalError(error.message);
      return responseError(failure.message, failure.status);
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

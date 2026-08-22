import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import { parseEnrollmentProgram } from "@/lib/enrollment/types";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request) {
  const actor = await loadEnrollmentActor();
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });
  if (!actor.actor.isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const program = typeof body?.program === "string" ? parseEnrollmentProgram(body.program) : "aca";
  if (!email || typeof body?.enabled !== "boolean" || !program) return NextResponse.json({ error: "email, enabled and a valid program are required." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const account = await supabase.from("portal_account").select("email").eq("email", email).eq("is_active", true).maybeSingle();
  if (account.error) return NextResponse.json({ error: account.error.message }, { status: 500 });
  if (!account.data) return NextResponse.json({ error: "Person is not an active account." }, { status: 400 });
  // Explicit conflict target: the primary key is (email, program), so without
  // it a toggle would insert a duplicate row instead of updating the selected program.
  const result = await supabase.from("enrollment_queue_members").upsert({ email, program, enabled: body.enabled, updated_by_email: actor.actor.email, updated_at: new Date().toISOString() }, { onConflict: "email,program" }).select("email,enabled,program").single();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  await broadcastEnrollmentChanged(program);
  return NextResponse.json({ member: result.data });
}

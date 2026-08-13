import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request) {
  const actor = await loadEnrollmentActor();
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });
  if (!actor.actor.isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || typeof body?.enabled !== "boolean") return NextResponse.json({ error: "email and enabled are required." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const account = await supabase.from("portal_account").select("email").eq("email", email).eq("is_active", true).maybeSingle();
  if (account.error) return NextResponse.json({ error: account.error.message }, { status: 500 });
  if (!account.data) return NextResponse.json({ error: "Person is not an active account." }, { status: 400 });
  const result = await supabase.from("enrollment_queue_members").upsert({ email, enabled: body.enabled, updated_by_email: actor.actor.email, updated_at: new Date().toISOString() }).select("email,enabled").single();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  await broadcastEnrollmentChanged("aca");
  return NextResponse.json({ member: result.data });
}

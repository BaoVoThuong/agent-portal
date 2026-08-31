import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, canWorkLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { isLeadProduct } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const SETTINGS_COLUMNS = "product,no_contact_hours,stale_days,max_attempts,updated_by_email,updated_at";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canWorkLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await getSupabaseAdmin()
    .from("lead_alert_settings")
    .select(SETTINGS_COLUMNS)
    .order("product");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data ?? [] });
}

export async function PATCH(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const product = body?.product;
  if (!isLeadProduct(product)) return NextResponse.json({ error: "Unknown product." }, { status: 400 });

  const values: Record<string, number> = {};
  for (const key of ["no_contact_hours", "stale_days", "max_attempts"] as const) {
    const value = typeof body?.[key] === "number" ? body[key] : Number(body?.[key]);
    if (!Number.isInteger(value) || value <= 0) {
      return NextResponse.json({ error: `${key} must be greater than 0.` }, { status: 400 });
    }
    values[key] = value;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("lead_alert_settings")
    .upsert({
      product,
      ...values,
      updated_by_email: actor.email.trim().toLowerCase(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "product" })
    .select(SETTINGS_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ setting: data });
}

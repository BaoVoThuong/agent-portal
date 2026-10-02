import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await auth();
  const actorEmail = session?.user?.email?.trim().toLowerCase();
  if (!session || !actorEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!can(session.user.permissions, PERMISSIONS.NOTIFICATION_ALERTS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    alertsMuted?: unknown;
  } | null;
  if (typeof body?.alertsMuted !== "boolean") {
    return NextResponse.json(
      { error: "alertsMuted must be true or false." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data: account, error: accountError } = await supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select("email")
    .eq("id", id)
    .maybeSingle();
  if (accountError) {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }
  if (!account?.email) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const email = account.email.trim().toLowerCase();
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("notification_preferences")
    .upsert(
      {
        email,
        sound_enabled: !body.alertsMuted,
        updated_at: updatedAt,
        updated_by_email: actorEmail,
      },
      { onConflict: "email" },
    )
    .select("email,sound_enabled,updated_by_email,updated_at")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    alertsMuted: data.sound_enabled === false,
    updatedBy: data.updated_by_email,
    updatedAt: data.updated_at,
  });
}

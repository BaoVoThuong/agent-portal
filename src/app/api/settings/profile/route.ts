import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const session = await auth();
  const email = session?.user?.email;

  // Every signed-in account may rename itself (2026-10-17); a disabled
  // account matches no row in the update below.
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json(
      { error: "Display name is required." },
      { status: 400 }
    );
  }
  if (name.length > 120) {
    return NextResponse.json(
      { error: "Display name must be 120 characters or less." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .update({ name })
    .eq("email", email)
    .eq("is_active", true)
    .select("email,name,agent_id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const row = data as { email: string; name: string | null; agent_id: string | null };
  return NextResponse.json({
    profile: {
      email: row.email,
      name: row.name ?? "",
      agentId: row.agent_id ?? null,
    },
  });
}

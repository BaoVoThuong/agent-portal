import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import bcrypt from "bcryptjs";

function isLocalPasswordHash(value: string | null | undefined): value is string {
  return Boolean(value && /^\$2[aby]\$/.test(value));
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    const email = session?.user?.email;

    // Every signed-in account may change its own password (2026-10-17);
    // disabled accounts are refused below.
    if (!email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";
    const currentPassword =
      typeof body?.currentPassword === "string" ? body.currentPassword : "";

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: account, error: accountError } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("password_hash,is_active")
      .eq("email", email)
      .maybeSingle();

    if (accountError) {
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }
    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    if ((account as { is_active: boolean | null }).is_active === false) {
      return NextResponse.json({ error: "This account is disabled." }, { status: 403 });
    }

    const currentHash = (account as { password_hash: string | null }).password_hash;
    if (isLocalPasswordHash(currentHash)) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required." },
          { status: 400 }
        );
      }
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, currentHash);
      if (!isCurrentPasswordValid) {
        return NextResponse.json(
          { error: "Current password is incorrect." },
          { status: 400 }
        );
      }
      const isSamePassword = await bcrypt.compare(password, currentHash);
      if (isSamePassword) {
        return NextResponse.json(
          { error: "New password must be different from the current password." },
          { status: 400 }
        );
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const { data: updatedAccount, error } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .update({ password_hash: hashedPassword })
      .eq("email", email)
      .eq("is_active", true)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updatedAccount) {
      return NextResponse.json({ error: "This account is disabled." }, { status: 403 });
    }

    return NextResponse.json({ message: "Password updated." });
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

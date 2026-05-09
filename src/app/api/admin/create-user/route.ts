import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { assignDefaultRoleToUser } from "@/lib/rbac/access";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  try {
    const { email, password, name, secret } = await req.json();
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";

    // Kiểm tra mã bí mật để bảo mật
    if (secret !== process.env.ADMIN_SECRET_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!normalizedEmail || !password) {
      return NextResponse.json({ error: "Missing email or password" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .insert([
        {
          email: normalizedEmail,
          password_hash: hashedPassword,
          name: name || null,
          role: "agent",
          is_active: true,
        },
      ])
      .select("id,email,name");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data?.[0]?.id) {
      await assignDefaultRoleToUser(data[0].id, "agent");
    }

    return NextResponse.json({
      message: "User created successfully",
      user: { email: data[0].email, name: data[0].name },
    });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

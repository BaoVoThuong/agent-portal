import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  try {
    const { email, password, name, secret } = await req.json();

    // Kiểm tra mã bí mật để bảo mật
    if (secret !== process.env.ADMIN_SECRET_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!email || !password) {
      return NextResponse.json({ error: "Missing email or password" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          email,
          password_hash: hashedPassword,
          name: name || null,
        },
      ])
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      message: "User created successfully",
      user: { email: data[0].email, name: data[0].name },
    });
  } catch (err) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { getSupabaseAdmin } from "@/lib/supabase";
import bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    Credentials({
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const supabase = getSupabaseAdmin();
        const { data: user } = await supabase
          .from("users")
          .select("*")
          .eq("email", credentials.email)
          .single();

        if (!user || !user.password_hash) return null;

        const isPasswordCorrect = await bcrypt.compare(
          credentials.password as string,
          user.password_hash
        );

        if (!isPasswordCorrect) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  pages: {
    signIn: "/signin",
    error: "/auth/error",
  },
  callbacks: {
    authorized: ({ auth }) => !!auth?.user?.email,
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        if (!user.email) return false;

        const supabase = getSupabaseAdmin();
        const { data: existingUser } = await supabase
          .from("users")
          .select("id")
          .eq("email", user.email)
          .single();

        if (existingUser) return true;

        // Cơ chế "Website lớn": Tự động cho phép nếu thuộc domain công ty
        const allowedDomain = "excelplannings.com";
        if (user.email.endsWith(`@${allowedDomain}`)) {
          // Tự động tạo user mới trong database
          await supabase.from("users").insert([
            {
              email: user.email,
              name: user.name,
              password_hash: "google-auth", // Đánh dấu đây là user dùng Google
            },
          ]);
          return true;
        }

        // Nếu không thuộc domain và chưa có trong DB thì chặn
        return false;
      }
      return true;
    },
  },
});

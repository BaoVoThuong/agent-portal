import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { getSupabaseAdmin } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import type { UserRole } from "@/lib/config";

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
          .select("id,email,name,password_hash,role,is_active")
          .eq("email", credentials.email)
          .single();

        if (!user || !user.password_hash || user.is_active === false) {
          return null;
        }

        const isPasswordCorrect = await bcrypt.compare(
          credentials.password as string,
          user.password_hash
        );

        if (!isPasswordCorrect) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: (user.role ?? "agent") as UserRole,
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
          .select("id,is_active")
          .eq("email", user.email)
          .single();

        if (existingUser) return existingUser.is_active !== false;

        // Cơ chế "Website lớn": Tự động cho phép nếu thuộc domain công ty
        const allowedDomain = "excelplannings.com";
        if (user.email.endsWith(`@${allowedDomain}`)) {
          // Tự động tạo user mới trong database
          await supabase.from("users").insert([
            {
              email: user.email,
              name: user.name,
              password_hash: "google-auth", // Đánh dấu đây là user dùng Google
              role: "agent",
              is_active: true,
            },
          ]);
          return true;
        }

        // Nếu không thuộc domain và chưa có trong DB thì chặn
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.role) {
        token.role = user.role;
      }

      if (token.email && !token.role) {
        const supabase = getSupabaseAdmin();
        const { data: dbUser } = await supabase
          .from("users")
          .select("role,is_active")
          .eq("email", token.email)
          .single();

        if (dbUser?.is_active !== false) {
          token.role = (dbUser?.role ?? "agent") as UserRole;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role ?? "agent") as UserRole;
      }
      return session;
    },
  },
});

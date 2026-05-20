import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { getSupabaseAdmin } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import { PORTAL_ACCOUNT_TABLE, type UserRole } from "@/lib/config";
import {
  assignDefaultRoleToUser,
  getUserAccessByEmail,
} from "@/lib/rbac/access";
import {
  getClientIp,
  isLoginRateLimited,
  recordLoginAttempt,
} from "@/lib/auth/rate-limit";

// Fixed valid hash so bcrypt.compare runs at full cost even when the user does
// not exist — prevents timing-based account enumeration.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  "invalid-password-placeholder",
  10
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    Credentials({
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = String(credentials.email).trim().toLowerCase();
        const ip = getClientIp(request as Request | undefined);

        if (await isLoginRateLimited(email)) {
          return null;
        }

        const supabase = getSupabaseAdmin();
        const { data: user } = await supabase
          .from(PORTAL_ACCOUNT_TABLE)
          .select("id,email,name,password_hash,role,is_active")
          .eq("email", email)
          .single();

        // Always run a comparison (against a dummy hash when the account is
        // missing or has no password) to keep response timing constant.
        const passwordHash = user?.password_hash ?? DUMMY_PASSWORD_HASH;
        const isPasswordCorrect = await bcrypt.compare(
          credentials.password as string,
          passwordHash
        );

        const isValid = Boolean(
          user &&
            user.password_hash &&
            user.is_active !== false &&
            isPasswordCorrect
        );

        await recordLoginAttempt(email, ip, isValid);

        if (!isValid || !user) return null;

        const access = await getUserAccessByEmail(user.email);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: access.legacyRole,
          roles: access.roles,
          permissions: access.permissions,
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
          .from(PORTAL_ACCOUNT_TABLE)
          .select("id,is_active")
          .eq("email", user.email)
          .single();

        if (existingUser) return existingUser.is_active !== false;

        const allowedDomain = process.env.AUTH_GOOGLE_ALLOWED_DOMAIN?.trim();
        if (allowedDomain && user.email.endsWith(`@${allowedDomain}`)) {
          const { data: createdUser } = await supabase
            .from(PORTAL_ACCOUNT_TABLE)
            .insert([
              {
                email: user.email,
                name: user.name,
                password_hash: "google-auth", // Đánh dấu đây là user dùng Google
                role: "agent",
                is_active: true,
              },
            ])
            .select("id")
            .single();

          if (createdUser?.id) {
            await assignDefaultRoleToUser(createdUser.id, "agent");
          }

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

      if (user?.roles) {
        token.roles = user.roles;
      }

      if (user?.permissions) {
        token.permissions = user.permissions;
      }

      if (token.email) {
        const access = await getUserAccessByEmail(token.email);
        if (access.isActive) {
          token.role = access.legacyRole;
          token.roles = access.roles;
          token.permissions = access.permissions;
        } else {
          token.roles = [];
          token.permissions = [];
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role ?? "agent") as UserRole;
        session.user.roles = Array.isArray(token.roles) ? token.roles : [];
        session.user.permissions = Array.isArray(token.permissions)
          ? token.permissions
          : [];
      }
      return session;
    },
  },
});

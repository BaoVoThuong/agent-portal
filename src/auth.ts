import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { getSupabaseAdmin } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import {
  getClientIp,
  isLoginRateLimited,
  recordLoginAttempt,
} from "@/lib/auth/rate-limit";
import { createSharedLookup } from "@/lib/shared-lookup";

// Fixed valid hash so bcrypt.compare runs at full cost even when the user does
// not exist — prevents timing-based account enumeration. Keep it lazy so every
// server/auth module load does not pay bcrypt cost before a credentials login.
let dummyPasswordHash: string | null = null;
function getDummyPasswordHash(): string {
  return (dummyPasswordHash ??= bcrypt.hashSync(
    "invalid-password-placeholder",
    10,
  ));
}

// Every auth check consults the shared lookup. Its one-minute TTL bounds stale
// permissions across instances; invalidation clears this instance immediately.
const RBAC_REFRESH_TTL_MS = 0;

// `await auth()` does not persist a refreshed JWT cookie in this next-auth
// version. Every request checks this per-instance lookup instead; the key is
// the token email, and failed reads are not reused.
const RBAC_LOOKUP_REUSE_MS = 60 * 1000;
const rbacLookup = createSharedLookup(getUserAccessByEmail, {
  ttlMs: RBAC_LOOKUP_REUSE_MS,
  keep: (access) => access.userId !== null,
});

export function invalidateRbacLookups(): void {
  rbacLookup.invalidate();
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Nền chung với `proxy.ts`: pages + callback `authorized` khai một chỗ duy
  // nhất. Bản đầy đủ này thêm providers và các callback có chạm database.
  ...authConfig,
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
          .select("id,email,name,agent_id,password_hash,is_active")
          .eq("email", email)
          .single();

        // Always run a comparison (against a dummy hash when the account is
        // missing or has no password) to keep response timing constant.
        const passwordHash = user?.password_hash ?? getDummyPasswordHash();
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
          agentId: user.agent_id ?? null,
          permissions: access.permissions,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
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
          const { error: createError } = await supabase.rpc("create_account_with_default_role", {
            p_email: user.email,
            p_name: user.name ?? null,
          });
          if (createError) {
            console.error("[auth] could not create Google account", { error: createError.message });
            return false;
          }
          return true;
        }

        // Nếu không thuộc domain và chưa có trong DB thì chặn
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.permissions) {
        token.permissions = user.permissions;
      }

      if (user && "agentId" in user) {
        token.agentId = user.agentId ?? null;
      }

      // Credentials already loaded access in authorize(). Reuse that result
      // for the first JWT callback; OAuth users and expired tokens refresh
      // from the canonical RBAC tables.
      const accessProvidedAtSignIn = Boolean(
        user && Array.isArray(user.permissions),
      );
      if (accessProvidedAtSignIn) {
        token.rbacRefreshedAt = Date.now();
      }
      const lastRbacRefresh = Number(token.rbacRefreshedAt ?? 0);
      const shouldRefreshRbac =
        !accessProvidedAtSignIn &&
        Date.now() - lastRbacRefresh >= RBAC_REFRESH_TTL_MS;

      if (token.email && shouldRefreshRbac) {
        const access = await rbacLookup.get(token.email);
        token.permissions = access.isActive ? access.permissions : [];
        // Tokens issued before 2026-10-09 still carry role names and the
        // legacy admin/agent role. Nothing reads them; drop them from the token
        // so no future code is tempted to. The cookie retains them until sign-in.
        delete token.role;
        delete token.roles;
        token.agentId = access.agentId;
        token.rbacRefreshedAt = Date.now();
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.permissions = Array.isArray(token.permissions)
          ? token.permissions
          : [];
        session.user.agentId = (token.agentId as string | null) ?? null;
      }
      return session;
    },
  },
});

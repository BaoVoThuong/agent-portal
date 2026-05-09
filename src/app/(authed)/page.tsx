import { getSupabaseAdmin } from "@/lib/supabase";
import type { Entry } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import EntryGrid from "./EntryGrid";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requirePermission(
    PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH_OWN
  );
  const email = session!.user!.email!;
  const canViewAll = can(
    session.user.permissions,
    PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH_ALL
  );

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("entries")
    .select("*")
    .order("created_at", { ascending: false });

  if (!canViewAll) {
    query = query.eq("agent_email", email);
  }

  const { data } = await query;
  const initialHistory = (data ?? []) as Entry[];

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#16233a]">
          Health Enrollment
        </h1>
        <p className="mt-1 text-sm text-[#667085]">
          Manage client insurance enrollments. Data is securely tracked and synced to centralized records.
        </p>
      </header>
      <EntryGrid initialHistory={initialHistory} />
    </div>
  );
}

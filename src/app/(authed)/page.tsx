import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Entry } from "@/lib/config";
import EntryGrid from "./EntryGrid";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  const email = session!.user!.email!;

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("entries")
    .select("*")
    .eq("agent_email", email)
    .order("created_at", { ascending: false });
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

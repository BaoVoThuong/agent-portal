import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { AccountUser } from "@/lib/config";
import AccountManagerClient from "./AccountManagerClient";

export const dynamic = "force-dynamic";

export default async function AccountManagerPage() {
  const session = await auth();

  if (session?.user?.role !== "admin") {
    redirect("/");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("id,email,name,role,is_active,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <AccountManagerClient
      currentUserEmail={session.user.email ?? ""}
      initialUsers={(data ?? []) as AccountUser[]}
    />
  );
}

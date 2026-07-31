import { getSupabaseAdmin } from "@/lib/supabase";
import type { EnrollmentActor } from "@/lib/enrollment/access";

export async function canActorExportImport(actor: EnrollmentActor): Promise<boolean> {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;

  const { data, error } = await getSupabaseAdmin()
    .from("task_agents")
    .select("email")
    .eq("email", actor.email)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

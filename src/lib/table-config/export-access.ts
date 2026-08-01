import type { EnrollmentActor } from "@/lib/enrollment/access";

export async function canActorExportImport(actor: EnrollmentActor): Promise<boolean> {
  return actor.isManager;
}

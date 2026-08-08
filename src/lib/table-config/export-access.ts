import type { EnrollmentActor } from "@/lib/enrollment/access";

export async function canActorExport(actor: EnrollmentActor): Promise<boolean> {
  return actor.isManager;
}

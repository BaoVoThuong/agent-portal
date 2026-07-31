import {
  canManageEnrollmentOptions,
  loadEnrollmentActor,
  type EnrollmentActor,
} from "@/lib/enrollment/access";

export async function loadConfigActor() {
  return loadEnrollmentActor();
}

export async function loadConfigAdmin(): Promise<
  | { ok: true; actor: EnrollmentActor }
  | { ok: false; error: "Unauthorized" | "Forbidden"; status: 401 | 403 }
> {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) return actorResult;
  if (!canManageEnrollmentOptions(actorResult.actor)) {
    return { ok: false, error: "Forbidden", status: 403 };
  }
  return actorResult;
}

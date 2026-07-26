import { auth } from "@/auth";
import {
  buildTaskActor,
  canAccessBoard,
  isTaskViewAdmin,
} from "@/lib/tasks/access";
import type { TaskActor } from "@/lib/tasks/types";

export type EnrollmentActor = TaskActor;

export function canAccessEnrollment(actor: EnrollmentActor): boolean {
  return canAccessBoard(actor);
}

export function canManageEnrollmentOptions(actor: EnrollmentActor): boolean {
  return actor.isManager;
}

export async function loadEnrollmentActor():
  Promise<
    | { ok: true; actor: EnrollmentActor }
    | { ok: false; error: "Unauthorized"; status: 401 }
    | { ok: false; error: "Forbidden"; status: 403 }
  > {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Unauthorized", status: 401 };

  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!canAccessEnrollment(actor)) {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  return { ok: true, actor };
}

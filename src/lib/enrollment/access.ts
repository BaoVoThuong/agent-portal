import { auth } from "@/auth";
import {
  buildTaskActor,
  canAccessBoard,
  isTaskViewAdmin,
} from "@/lib/tasks/access";
import type { TaskActor } from "@/lib/tasks/types";

export type EnrollmentActor = TaskActor;

export type EnrollmentRecordAccessFields = {
  id?: string | null;
  caller_email?: string | null;
  responsible_enroll_email?: string | null;
  created_by_email?: string | null;
};

export function canAccessEnrollment(actor: EnrollmentActor): boolean {
  return canAccessBoard(actor);
}

export function canManageEnrollmentOptions(actor: EnrollmentActor): boolean {
  return actor.isManager;
}

export function canMutateEnrollmentRecord(
  actor: EnrollmentActor,
  record: EnrollmentRecordAccessFields
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isDirectEnrollmentStakeholder(actor.email, record);
}

function isDirectEnrollmentStakeholder(
  email: string,
  record: EnrollmentRecordAccessFields
): boolean {
  const normalized = normalizeEmail(email);
  return [
    record.caller_email,
    record.responsible_enroll_email,
    record.created_by_email,
  ].some((value) => normalizeEmail(value) === normalized);
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
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

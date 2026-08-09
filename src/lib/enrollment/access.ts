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

export type EnrollmentMembershipFlags = {
  /** Agent owner OR promoted assistant. */
  isAgentOwner?: boolean;
  isCaller?: boolean;
  isResponsible?: boolean;
  isCreator?: boolean;
};

export type EnrollmentCapabilities = {
  canView: boolean;
  canEditFields: boolean;
  canChangeStage: boolean;
  canReopen: boolean;
  canReviewQC: boolean;
  canAssignPeople: boolean;
  canArchive: boolean;
  /** Changing agent_email moves the record between visibility scopes. */
  canTransferAgent: boolean;
};

export function canAccessEnrollment(actor: EnrollmentActor): boolean {
  return canAccessBoard(actor);
}

export function canManageEnrollmentOptions(actor: EnrollmentActor): boolean {
  return actor.isManager;
}

/**
 * Decides what an actor may do to a record that has already passed the scope
 * boundary. Record visibility itself is enforced by enrollment/scope.ts.
 */
export function resolveEnrollmentCapabilities(
  actor: EnrollmentActor,
  flags: EnrollmentMembershipFlags = {}
): EnrollmentCapabilities {
  if (actor.isManager) {
    return {
      canView: true,
      canEditFields: true,
      canChangeStage: true,
      canReopen: true,
      canReviewQC: true,
      canAssignPeople: true,
      canArchive: true,
      canTransferAgent: true,
    };
  }
  if (!actor.isWorker) {
    return {
      canView: false,
      canEditFields: false,
      canChangeStage: false,
      canReopen: false,
      canReviewQC: false,
      canAssignPeople: false,
      canArchive: false,
      canTransferAgent: false,
    };
  }

  const isOwner = Boolean(flags.isAgentOwner);
  const isDoingTheWork = Boolean(flags.isCaller) || Boolean(flags.isResponsible);

  return {
    canView: true,
    canEditFields: isOwner || isDoingTheWork || Boolean(flags.isCreator),
    canChangeStage: isOwner || isDoingTheWork,
    canReopen: isOwner || isDoingTheWork,
    canReviewQC: isOwner,
    canAssignPeople: isOwner,
    canArchive: isOwner,
    // Mirrors CS: agent ownership transfer is a content decision reserved for
    // managers, agent-owner/assistants, and the original creator.
    canTransferAgent: isOwner || Boolean(flags.isCreator),
  };
}

export function canCreateEnrollmentWithScope(
  actor: EnrollmentActor,
  hasAgentScope: boolean
): boolean {
  if (actor.isManager) return true;
  return actor.isWorker && hasAgentScope;
}

export function canMutateEnrollmentRecord(
  actor: EnrollmentActor,
  record: EnrollmentRecordAccessFields
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return isDirectEnrollmentStakeholder(actor.email, record);
}

// Narrower than canMutateEnrollmentRecord on purpose — mirrors CS's
// canDeleteTask() (manager or agent-owner only, not every stakeholder who
// can edit a task). Enrollment has no agent-ownership model wired through
// like CS does, so "owner" here is the record's original creator — the
// closest native equivalent, using data already on every record.
export function canArchiveEnrollmentRecord(
  actor: EnrollmentActor,
  record: EnrollmentRecordAccessFields
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return (
    normalizeEnrollmentActorEmail(record.created_by_email) ===
    normalizeEnrollmentActorEmail(actor.email)
  );
}

function isDirectEnrollmentStakeholder(
  email: string,
  record: EnrollmentRecordAccessFields
): boolean {
  const normalized = normalizeEnrollmentActorEmail(email);
  return [
    record.caller_email,
    record.responsible_enroll_email,
    record.created_by_email,
  ].some((value) => normalizeEnrollmentActorEmail(value) === normalized);
}

export function normalizeEnrollmentActorEmail(
  email: string | null | undefined
): string {
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

import { auth } from "@/auth";
import {
  buildTaskActor,
  canAccessBoard,
  isTaskViewAdmin,
} from "@/lib/tasks/access";
import type { TaskActor } from "@/lib/tasks/types";

export type EnrollmentActor = TaskActor;

export type EnrollmentMembershipFlags = {
  /** Agent owner OR promoted assistant. */
  isAgentOwner?: boolean;
  isCaller?: boolean;
  isResponsible?: boolean;
  isCreator?: boolean;
};

export type EnrollmentCapabilities = {
  canView: boolean;
  /** Client name, FUB link and description — mirrors CS task content. */
  canEditContent: boolean;
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
      canEditContent: true,
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
      canEditContent: false,
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
    canEditContent: isOwner || Boolean(flags.isCreator),
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

export function normalizeEnrollmentActorEmail(
  email: string | null | undefined
): string {
  return email?.trim().toLowerCase() ?? "";
}

export async function loadEnrollmentActor():
  Promise<
    | { ok: true; actor: EnrollmentActor; permissions: string[] }
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

  return { ok: true, actor, permissions: session.user.permissions ?? [] };
}

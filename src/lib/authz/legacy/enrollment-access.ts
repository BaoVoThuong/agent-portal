/**
 * BẢN ĐÓNG BĂNG của `src/lib/enrollment/access.ts` trước Phase D (2026-09-28).
 *
 * KHÔNG dùng trong code chạy thật. Chỉ để:
 *   - test tương đương: quyết định mới (grant) phải khớp quyết định cũ với mọi
 *     persona có role chưa chuyển (grant tương thích);
 *   - `scripts/authz-diff`: so hai mô hình trên dữ liệu production (read-only).
 *
 * Không sửa logic ở đây. Xoá ở Phase H cùng `compat.ts`.
 */
import { canAccessBoard, type TaskActor } from "./task-access";

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

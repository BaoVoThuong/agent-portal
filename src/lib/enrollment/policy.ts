// Luật quyền Enrollment — THUẦN (không I/O), dùng chung cho server và client.
// Phần có I/O (dựng actor từ phiên) ở access.ts.
import type { Action } from "@/lib/authz/catalog";
import { hasGrant, scopeMatches, type RelationFacts } from "@/lib/authz/grants";
import type { TaskActor } from "@/lib/tasks/types";

/**
 * Cùng hình với TaskActor, nhưng hai cờ tóm tắt đọc grant `enrollment.*`:
 * `isManager` = `enrollment.read:all`, `isWorker` = `enrollment.read` bất kỳ.
 */
export type EnrollmentActor = TaskActor;

export function enrollmentActorFromGrants(
  email: string,
  grants: readonly string[]
): EnrollmentActor {
  return {
    email,
    grants,
    isManager: hasGrant(grants, "enrollment.read", "all"),
    isWorker: hasGrant(grants, "enrollment.read"),
  };
}

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
  return hasGrant(actor.grants, "enrollment.read");
}

export function canManageEnrollmentOptions(actor: EnrollmentActor): boolean {
  return hasGrant(actor.grants, "enrollment.options.manage");
}

/** Overview ACA/Medicare và workload. */
export function canReadEnrollmentOverview(actor: EnrollmentActor): boolean {
  return hasGrant(actor.grants, "enrollment.overview.read");
}

/** Có `action` ở scope `all` — dùng để bỏ qua các truy vấn quan hệ không cần. */
export function holdsEnrollmentScopeAll(actor: EnrollmentActor, action: Action): boolean {
  return hasGrant(actor.grants, action, "all");
}

/**
 * Quan hệ với một hồ sơ (§I.3): caller/responsible = `assigned`, người tạo =
 * `reported`, agent của hồ sơ hoặc assistant của agent đó = `agent_owned` /
 * `assistant_for_agent` (cờ gộp nên bật cả hai — grant tương thích luôn có đủ).
 */
function enrollmentFacts(flags: EnrollmentMembershipFlags): RelationFacts {
  const isOwner = Boolean(flags.isAgentOwner);
  return {
    assigned: Boolean(flags.isCaller) || Boolean(flags.isResponsible),
    reported: Boolean(flags.isCreator),
    agent_owned: isOwner,
    assistant_for_agent: isOwner,
  };
}

/**
 * Decides what an actor may do to a record that has already passed the scope
 * boundary. Record visibility itself is enforced by enrollment/scope.ts, so
 * `canView` only asks whether the actor reads enrollment at all.
 */
export function resolveEnrollmentCapabilities(
  actor: EnrollmentActor,
  flags: EnrollmentMembershipFlags = {}
): EnrollmentCapabilities {
  const facts = enrollmentFacts(flags);
  const allowed = (action: Action) => scopeMatches(actor.grants, action, facts);
  const canChangeStage = allowed("enrollment.stage.update");
  return {
    canView: canAccessEnrollment(actor),
    canEditContent: allowed("enrollment.content.update"),
    canEditFields: allowed("enrollment.fields.update"),
    canChangeStage,
    canReopen: canChangeStage,
    canReviewQC: allowed("enrollment.qc_review"),
    canAssignPeople: allowed("enrollment.people.assign"),
    canArchive: allowed("enrollment.archive"),
    // Mirrors CS: agent ownership transfer is a content decision reserved for
    // managers, agent-owner/assistants, and the original creator.
    canTransferAgent: allowed("enrollment.agent.transfer"),
  };
}

export function canCreateEnrollmentWithScope(
  actor: EnrollmentActor,
  hasAgentScope: boolean
): boolean {
  return scopeMatches(actor.grants, "enrollment.create", {
    agent_owned: hasAgentScope,
    assistant_for_agent: hasAgentScope,
  });
}

export function normalizeEnrollmentActorEmail(
  email: string | null | undefined
): string {
  return email?.trim().toLowerCase() ?? "";
}

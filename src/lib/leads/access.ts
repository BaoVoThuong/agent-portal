import type { Action } from "@/lib/authz/catalog";
import { hasGrant, scopeMatches, type RelationFacts } from "@/lib/authz/grants";
import type { LeadRow } from "./types";

/**
 * Dựng từ grant (`leadActorFromGrants`). Mọi quyết định đọc `grants`; hai cờ
 * chỉ là tóm tắt cho đường truy vấn và UI: `isManager` = `lead.read:all`,
 * `isWorker` = `lead.read` ở bất kỳ scope nào. Legacy admin quản lead không cần
 * `lead.manage` — luật đó giờ nằm trong grant tương thích (compat.ts, luật 3).
 */
export type LeadActor = {
  email: string;
  grants: readonly string[];
  isManager: boolean;
  isWorker: boolean;
};

/**
 * Extra ways a worker reaches one lead. Resolved once per request against
 * agent_members (see lib/leads/membership.ts) and passed in, so every check
 * below stays pure and unit-testable.
 */
export type LeadMembershipFlags = {
  /** Actor is the assigned agent, or a promoted Assistant for that agent. */
  isOwnerOrAssistant?: boolean;
};

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

export function leadActorFromGrants(email: string, grants: readonly string[]): LeadActor {
  return {
    email,
    grants,
    isManager: hasGrant(grants, "lead.read", "all"),
    isWorker: hasGrant(grants, "lead.read"),
  };
}

/** Có `action` ở scope `all` — dùng để bỏ qua truy vấn agent_members không cần. */
export function holdsLeadScopeAll(actor: LeadActor, action: Action): boolean {
  return hasGrant(actor.grants, action, "all");
}

/** Vào được module lead (đọc danh sách, cài đặt, từ vựng, trọng số). */
export function canWorkLeads(actor: LeadActor): boolean {
  return hasGrant(actor.grants, "lead.read");
}

export function canCreateLeads(actor: LeadActor): boolean {
  return hasGrant(actor.grants, "lead.create");
}

/** Gán / chia lead, roster và trọng số chia lead. */
export function canAssignLeads(actor: LeadActor): boolean {
  return hasGrant(actor.grants, "lead.assign");
}

export function canImportLeads(actor: LeadActor): boolean {
  return hasGrant(actor.grants, "lead.import");
}

/** Cài đặt, sự kiện, từ vựng của module lead. */
export function canManageLeadSettings(actor: LeadActor): boolean {
  return hasGrant(actor.grants, "lead.settings.manage");
}

export function canReadLeadOverview(actor: LeadActor): boolean {
  return hasGrant(actor.grants, "lead.overview.read");
}

/** Thiết kế cột bảng lead (/config). */
export function canConfigureLeadColumns(actor: LeadActor): boolean {
  return hasGrant(actor.grants, "lead.config.manage");
}

/**
 * Capability MỨC MODULE cho client (D9): server tính từ grant rồi gửi xuống,
 * thay cho một cờ `isManager` gộp năm nghĩa.
 */
export type LeadBoardAccess = {
  /** `lead.read:all` — lọc theo mọi người được giao. */
  readsAll: boolean;
  /** `lead.overview.read` */
  overview: boolean;
  /** `lead.create` */
  create: boolean;
  /** `lead.assign` — gán, chia pool, chọn hàng loạt. */
  assign: boolean;
  /** `lead.import` */
  import: boolean;
};

export function leadBoardAccessFor(actor: LeadActor): LeadBoardAccess {
  return {
    readsAll: actor.isManager,
    overview: canReadLeadOverview(actor),
    create: canCreateLeads(actor),
    assign: canAssignLeads(actor),
    import: canImportLeads(actor),
  };
}

/** True when the actor's own email is the one the lead is assigned to. */
export function isLeadOwner(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">
): boolean {
  const owner = normalize(lead.assigned_to_email);
  return owner !== "" && owner === normalize(actor.email);
}

/**
 * Quan hệ với một lead (§I.3): chính mình được giao = `assigned`; assistant của
 * agent được giao = `assistant_for_agent`.
 */
function leadFacts(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">,
  flags: LeadMembershipFlags
): RelationFacts {
  const owner = isLeadOwner(actor, lead);
  return {
    assigned: owner,
    assistant_for_agent: Boolean(flags.isOwnerOrAssistant) && !owner,
  };
}

/**
 * Managers and account admins see the whole queue. A worker sees a lead they
 * are assigned, and any lead assigned to an agent they are an Assistant for —
 * the same agent/assistant pairing the task board uses, read from agent_members.
 */
export function canViewLead(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">,
  flags: LeadMembershipFlags = {}
): boolean {
  return scopeMatches(actor.grants, "lead.read", leadFacts(actor, lead, flags));
}

/**
 * Editing a lead's data in place. Deliberately its own rule rather than reusing
 * canViewLead: if workers are ever allowed to browse the unassigned pool, that
 * must not silently become permission to edit it.
 */
export function canEditLead(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">,
  flags: LeadMembershipFlags = {}
): boolean {
  return scopeMatches(actor.grants, "lead.update", leadFacts(actor, lead, flags));
}

/**
 * Logging an interaction. Same reach as editing: a manager on any lead, a
 * worker on their own and on their agent's.
 *
 * This used to exclude a manager who was not the assigned agent, on the grounds
 * that contact_attempt_count and last_contacted_at are read as that agent's
 * record. The counters are per-LEAD, not per-person — they answer "has anyone
 * called this person yet", which is what the alert engine needs — and every
 * interaction row stores actor_email, so who actually made the call is never
 * lost. A manager covering for an agent on leave is ordinary work, and refusing
 * it just pushed that call outside the system entirely.
 *
 * Kept separate from canEditLead even though the two currently agree: logging a
 * conversation and correcting a field are different acts, and the RPC enforces
 * rules on logging that editing does not.
 */
export function canLogInteraction(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">,
  flags: LeadMembershipFlags = {}
): boolean {
  return scopeMatches(actor.grants, "lead.interaction.log", leadFacts(actor, lead, flags));
}

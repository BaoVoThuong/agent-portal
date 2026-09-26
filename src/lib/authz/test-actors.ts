import { enrollmentActorFromGrants, type EnrollmentActor } from "@/lib/enrollment/policy";
import { leadActorFromGrants, type LeadActor } from "@/lib/leads/access";
import { taskActorFromGrants } from "@/lib/tasks/access";
import type { TaskActor } from "@/lib/tasks/types";
import { deriveCompatGrants } from "./compat";

/**
 * Dựng actor cho TEST từ mô hình quyền cũ (permission phẳng + cờ admin), qua
 * đúng đường production: grant tương thích → actor từ grant.
 *
 * `isAdmin` của task = role mang tên task-admin (luật tương thích 1); của lead =
 * legacy admin (luật 3). Không dùng trong code chạy thật.
 */
export function compatGrantsFor(
  permissions: readonly string[],
  opts: { taskAdmin?: boolean; accountAdmin?: boolean } = {}
): string[] {
  return deriveCompatGrants({
    permissions,
    roles: opts.taskAdmin ? ["Task Admin"] : [],
    legacyRole: opts.accountAdmin ? "admin" : "agent",
  });
}

export function testTaskActor(
  permissions: readonly string[],
  email: string,
  opts?: { isAdmin?: boolean }
): TaskActor {
  return taskActorFromGrants(email, compatGrantsFor(permissions, { taskAdmin: opts?.isAdmin }));
}

export function testEnrollmentActor(
  permissions: readonly string[],
  email: string,
  opts?: { isAdmin?: boolean }
): EnrollmentActor {
  return enrollmentActorFromGrants(email, compatGrantsFor(permissions, { taskAdmin: opts?.isAdmin }));
}

/** Lead: `isAdmin` = legacy admin (quản lead không cần lead.manage — luật 3). */
export function testLeadActor(
  permissions: readonly string[],
  email: string,
  opts?: { isAdmin?: boolean }
): LeadActor {
  return leadActorFromGrants(email, compatGrantsFor(permissions, { accountAdmin: opts?.isAdmin }));
}

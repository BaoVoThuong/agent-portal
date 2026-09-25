import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  LEGACY_SUPER_ADMIN_ROLE_NAME,
  SYSTEM_ROLE_NAMES,
} from "@/lib/rbac/system-roles";
import type { Action, GrantScope } from "./catalog";
import { encodeGrant, normalizeGrants } from "./grants";

/**
 * GRANT TƯƠNG THÍCH — suy grant `{action, scope}` từ mô hình quyền cũ (permission
 * phẳng + tên role + cột `portal_account.role`), sao cho MỌI quyết định giữ
 * nguyên như trước (audit §9.3, "encode existing cohorts first").
 *
 * Đây là nơi DUY NHẤT còn đọc tên role để phân quyền. Gỡ ở Phase H, khi mọi role
 * đã chuyển sang `role_grants`.
 *
 * Luật tương thích mang theo:
 *   1. Task admin = `task.manage` VÀ (legacy admin hoặc role tên "Admin",
 *      "Super Admin", "Admin Health Task", "Task Admin") → mọi action task/
 *      enrollment ở scope `all` + backlog/overview/cấu hình.
 *   2. `shared_queue` được cấp cho mọi người có quyền task; việc TẮT nó khi người
 *      đó có roster/delegation nằm ở policy (`sharedQueueSuppressed`), không ở đây.
 *   3. Legacy admin quản lead không cần `lead.manage`.
 */

export type LegacyAccess = {
  permissions: readonly string[];
  roles: readonly string[];
  legacyRole: string | null | undefined;
};

const TASK_ADMIN_ROLE_NAMES: ReadonlySet<string> = new Set(["Admin Health Task", "Task Admin"]);

/** Admin toàn cục theo mô hình cũ: cột legacy hoặc role tên Admin / Super Admin. */
export function isLegacyAccountAdmin(access: Pick<LegacyAccess, "roles" | "legacyRole">): boolean {
  const roles = access.roles ?? [];
  return (
    access.legacyRole === "admin" ||
    roles.includes(SYSTEM_ROLE_NAMES.SUPER_ADMIN) ||
    roles.includes(LEGACY_SUPER_ADMIN_ROLE_NAME)
  );
}

/** Vai trò task-admin theo tên (luật tương thích 1). */
export function isLegacyTaskAdminRole(access: Pick<LegacyAccess, "roles" | "legacyRole">): boolean {
  return (
    isLegacyAccountAdmin(access) ||
    (access.roles ?? []).some((role) => TASK_ADMIN_ROLE_NAMES.has(role))
  );
}

const WORKER_TASK_GRANTS: ReadonlyArray<[Action, GrantScope[]]> = [
  ["task.read", ["assigned", "reported", "participating", "agent_owned", "assistant_for_agent", "shared_queue"]],
  ["task.create", ["agent_owned", "assistant_for_agent"]],
  ["task.content.update", ["reported", "agent_owned", "assistant_for_agent"]],
  ["task.due_date.update", ["assigned", "reported", "participating", "agent_owned", "assistant_for_agent", "shared_queue"]],
  ["task.status.update", ["assigned", "agent_owned", "assistant_for_agent"]],
  ["task.assign", ["agent_owned", "assistant_for_agent"]],
  ["task.delete", ["agent_owned", "assistant_for_agent"]],
  ["task.qc_review", ["agent_owned", "assistant_for_agent"]],
  ["task.activity.read", ["agent_owned", "assistant_for_agent"]],
];

const WORKER_ENROLLMENT_GRANTS: ReadonlyArray<[Action, GrantScope[]]> = [
  ["enrollment.read", ["assigned", "reported", "agent_owned", "assistant_for_agent", "shared_queue"]],
  ["enrollment.create", ["agent_owned", "assistant_for_agent"]],
  ["enrollment.content.update", ["reported", "agent_owned", "assistant_for_agent"]],
  ["enrollment.fields.update", ["assigned", "reported", "agent_owned", "assistant_for_agent"]],
  ["enrollment.stage.update", ["assigned", "agent_owned", "assistant_for_agent"]],
  ["enrollment.qc_review", ["agent_owned", "assistant_for_agent"]],
  ["enrollment.people.assign", ["agent_owned", "assistant_for_agent"]],
  ["enrollment.archive", ["agent_owned", "assistant_for_agent"]],
  ["enrollment.agent.transfer", ["reported", "agent_owned", "assistant_for_agent"]],
];

const LEAD_WORK_ACTIONS: readonly Action[] = ["lead.read", "lead.update", "lead.interaction.log"];

/** Suy grant tương thích. Kết quả đã chuẩn hoá (hợp lệ, khử trùng, sắp xếp). */
export function deriveCompatGrants(access: LegacyAccess): string[] {
  const permissions = new Set(access.permissions ?? []);
  const has = (key: string) => permissions.has(key);
  const out: string[] = [];
  const add = (action: Action, scopes: readonly GrantScope[]) => {
    for (const scope of scopes) out.push(encodeGrant({ action, scope }));
  };

  // ---------------------------------------------------------------- Task + Enrollment
  const taskWorker = has(PERMISSIONS.TASK_WORK) || has(PERMISSIONS.TASK_MANAGE);
  const taskAdmin = has(PERMISSIONS.TASK_MANAGE) && isLegacyTaskAdminRole(access);
  if (taskWorker) {
    for (const [action, scopes] of WORKER_TASK_GRANTS) add(action, scopes);
    for (const [action, scopes] of WORKER_ENROLLMENT_GRANTS) add(action, scopes);
  }
  if (taskAdmin) {
    for (const [action] of WORKER_TASK_GRANTS) add(action, ["all"]);
    for (const [action] of WORKER_ENROLLMENT_GRANTS) add(action, ["all"]);
    add("task.backlog.read", ["*"]);
    add("task.overview.read", ["*"]);
    add("task.config.manage", ["*"]);
    add("enrollment.options.manage", ["*"]);
    add("enrollment.overview.read", ["*"]);
    add("org.agent_roster.manage", ["*"]);
    add("org.assistant_delegation.manage", ["*"]);
  }
  if (has(PERMISSIONS.TASK_EXPORT)) {
    add("task.export", ["*"]);
    add("enrollment.export", ["*"]);
    add("provider.export", ["*"]);
  }
  if (has(PERMISSIONS.TASK_IMPORT)) {
    add("provider.import", ["*"]);
    // Import Enrollment ghi thẳng theo ID nên chỉ dành cho task admin (A8/S6).
    if (taskAdmin) add("enrollment.import", ["*"]);
  }
  if (has(PERMISSIONS.TASK_MANAGE)) add("notify.task.created", ["*"]);

  // ---------------------------------------------------------------- Lead
  const leadManager = has(PERMISSIONS.LEAD_MANAGE) || isLegacyAccountAdmin(access);
  const leadWorker = leadManager || has(PERMISSIONS.LEAD_WORK);
  if (leadWorker) {
    for (const action of LEAD_WORK_ACTIONS) add(action, ["assigned", "assistant_for_agent"]);
  }
  if (leadManager) {
    for (const action of LEAD_WORK_ACTIONS) add(action, ["all"]);
    add("lead.create", ["*"]);
    add("lead.assign", ["*"]);
    add("lead.import", ["*"]);
    add("lead.settings.manage", ["*"]);
    add("lead.overview.read", ["*"]);
    add("lead.config.manage", ["*"]);
  }

  // ---------------------------------------------------------------- Registration
  const viewAll = has(PERMISSIONS.COMPANY_VIEW_ALL);
  if (has(PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH)) {
    add("registration.health.read", viewAll ? ["own", "all"] : ["own"]);
    add("registration.health.create", ["*"]);
    add("registration.health.update", viewAll ? ["own", "all"] : ["own"]);
  }
  if (has(PERMISSIONS.CUSTOMER_REGISTRATION_PC)) {
    add("registration.pc.read", viewAll ? ["own", "all"] : ["own"]);
    add("registration.pc.create", ["*"]);
    add("registration.pc.update", viewAll ? ["own", "all"] : ["own"]);
  }

  // ---------------------------------------------------------------- Dashboard
  if (has(PERMISSIONS.AGENT_DASHBOARD_HEALTH)) {
    add("dashboard.health.agent.read", viewAll ? ["own", "all"] : ["own"]);
  }
  if (has(PERMISSIONS.AGENT_DASHBOARD_PC)) {
    add("dashboard.pc.agent.read", viewAll ? ["own", "all"] : ["own"]);
  }
  if (has(PERMISSIONS.COMPANY_DASHBOARD_HEALTH)) {
    add("dashboard.health.company.read", ["*"]);
    add("dashboard.health.company.defaults.manage", ["*"]);
  }
  if (has(PERMISSIONS.COMPANY_DASHBOARD_PC)) {
    add("dashboard.pc.company.read", ["*"]);
    add("dashboard.pc.company.defaults.manage", ["*"]);
  }
  if (viewAll) add("dashboard.agent.defaults.manage", ["*"]);

  // ---------------------------------------------------------------- Automation / Provider
  if (has(PERMISSIONS.AUTOMATION_HEALTH_STATEMENT)) add("automation.health_statement.run", ["*"]);
  if (has(PERMISSIONS.AUTOMATION_PC_STATEMENT)) add("automation.pc_statement.run", ["*"]);
  if (has(PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    add("provider.read", ["*"]);
    add("provider.update", ["*"]);
  }

  // ---------------------------------------------------------------- Time off
  if (has(PERMISSIONS.TIME_OFF_USER) || has(PERMISSIONS.TIME_OFF_ADMIN)) add("timeoff.request", ["*"]);
  if (has(PERMISSIONS.TIME_OFF_ADMIN)) {
    add("timeoff.manage", ["*"]);
    add("notify.timeoff.submitted", ["*"]);
  }

  // ---------------------------------------------------------------- Management / Settings
  if (has(PERMISSIONS.ACCOUNT_MANAGER)) add("account.manage", ["*"]);
  if (has(PERMISSIONS.ROLE_MANAGER)) {
    add("role.manage", ["*"]);
    // Role Manager từng sửa được mọi mặc định dashboard (dashboard-filter-defaults).
    add("dashboard.agent.defaults.manage", ["*"]);
    add("dashboard.health.company.defaults.manage", ["*"]);
    add("dashboard.pc.company.defaults.manage", ["*"]);
  }
  if (has(PERMISSIONS.SETTINGS)) add("settings.access", ["*"]);

  // ---------------------------------------------------------------- Oversight notifications
  // Người nhận leo thang hiện là `fetchAdminEmails` (legacy admin).
  if (access.legacyRole === "admin") {
    add("notify.task.escalation", ["*"]);
    add("notify.enrollment.qc", ["*"]);
    add("notify.enrollment.escalation", ["*"]);
  }

  return normalizeGrants(out);
}

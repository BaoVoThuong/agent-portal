import * as enrollment from "@/lib/enrollment/policy";
import * as lead from "@/lib/leads/access";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { canActorExport, canActorImport } from "@/lib/table-config/export-access";
import * as task from "@/lib/tasks/access";
import type { LegacyAccess } from "./compat";
import { isLegacyAccountAdmin } from "./compat";
import { hasGrant } from "./grants";
import * as legacyEnrollment from "./legacy/enrollment-access";
import * as legacyExport from "./legacy/export-access";
import * as legacyLead from "./legacy/lead-access";
import * as legacyTask from "./legacy/task-access";

/**
 * DECISION DIFF (D12): so quyết định CŨ (permission phẳng + tên role, bản đóng
 * băng trước Phase D) với quyết định MỚI (grant hiệu lực) của MỘT account.
 *
 * Role chưa chuyển sang grant cho ra grant tương thích nên phải KHÔNG có dòng
 * nào (test tương đương bảo đảm điều đó). Role đã chuyển ở Role Manager cho ra
 * đúng những thay đổi admin đã chọn — script in ra để người duyệt xác nhận.
 *
 * Thuần: không I/O. `scripts/authz-decision-diff.ts` đọc dữ liệu (read-only)
 * rồi gọi hàm này cho từng account.
 */
export type DecisionMismatch = { decision: string; legacy: boolean; next: boolean };

const ME = "me@x.com";
const OTHER = "agent.other@x.com";

function flagCombos<K extends string>(keys: readonly K[]): Record<K, boolean>[] {
  const out: Record<K, boolean>[] = [];
  for (let mask = 0; mask < 1 << keys.length; mask += 1) {
    const combo = {} as Record<K, boolean>;
    keys.forEach((key, index) => {
      combo[key] = Boolean(mask & (1 << index));
    });
    out.push(combo);
  }
  return out;
}

export function diffDecisions(access: LegacyAccess, grants: readonly string[]): DecisionMismatch[] {
  const out: DecisionMismatch[] = [];
  const check = (decision: string, legacy: boolean, next: boolean) => {
    if (legacy !== next) out.push({ decision, legacy, next });
  };
  const perms = access.permissions;
  const has = (key: string) => perms.includes(key);
  const user = { role: access.legacyRole ?? null, roles: [...access.roles] };

  // ------------------------------------------------------------------ Task
  const legacyTaskActor = legacyTask.buildTaskActor(perms, ME, {
    isAdmin: legacyTask.isTaskViewAdmin(user),
  });
  const taskActor = task.taskActorFromGrants(ME, grants);
  check("task.board", legacyTask.canAccessBoard(legacyTaskActor), task.canAccessBoard(taskActor));
  check("task.backlog", legacyTask.canSeeBacklog(legacyTaskActor), task.canSeeBacklog(taskActor));
  check("task.create_any", legacyTask.canCreateTask(legacyTaskActor), task.canCreateTask(taskActor));
  check("task.assign_any", legacyTask.canAssign(legacyTaskActor), task.canAssign(taskActor));
  check("task.config", legacyTaskActor.isManager, task.canManageTaskConfig(taskActor));
  check("task.overview", legacyTaskActor.isManager, task.canReadTaskOverview(taskActor));
  for (const hasAgentScope of [false, true]) {
    check(
      `task.create[agentScope=${hasAgentScope}]`,
      legacyTask.canCreateTaskWithScope(legacyTaskActor, hasAgentScope),
      task.canCreateTaskWithScope(taskActor, hasAgentScope)
    );
  }
  const taskKeys = ["isAssignee", "isAgentOwner", "isAgentMember", "isParticipant", "isReporter", "seesAllTasks"] as const;
  for (const agentEmail of [ME, OTHER]) {
    for (const flags of flagCombos(taskKeys)) {
      if (flags.isAgentMember && !flags.isAgentOwner) continue;
      if (agentEmail === ME && flags.isAgentMember) continue;
      const legacyCaps = legacyTask.resolveTaskCapabilities(legacyTaskActor, { assignee_email: null }, flags);
      const nextCaps = task.resolveTaskCapabilities(
        taskActor,
        { assignee_email: null, agent_email: agentEmail },
        flags
      );
      const on = Object.entries(flags).filter(([, value]) => value).map(([key]) => key).join("+") || "none";
      const who = agentEmail === ME ? "own-agent" : "other-agent";
      for (const key of Object.keys(legacyCaps) as (keyof typeof legacyCaps)[]) {
        check(`task.${key}[${who}:${on}]`, legacyCaps[key], nextCaps[key]);
      }
    }
  }

  // ------------------------------------------------------------------ Enrollment
  const enrollmentActor = enrollment.enrollmentActorFromGrants(ME, grants);
  check(
    "enrollment.board",
    legacyEnrollment.canAccessEnrollment(legacyTaskActor),
    enrollment.canAccessEnrollment(enrollmentActor)
  );
  check(
    "enrollment.options",
    legacyEnrollment.canManageEnrollmentOptions(legacyTaskActor),
    enrollment.canManageEnrollmentOptions(enrollmentActor)
  );
  check("enrollment.overview", legacyTaskActor.isManager, enrollment.canReadEnrollmentOverview(enrollmentActor));
  for (const flags of flagCombos(["isAgentOwner", "isCaller", "isResponsible", "isCreator"] as const)) {
    const legacyCaps = legacyEnrollment.resolveEnrollmentCapabilities(legacyTaskActor, flags);
    const nextCaps = enrollment.resolveEnrollmentCapabilities(enrollmentActor, flags);
    const on = Object.entries(flags).filter(([, value]) => value).map(([key]) => key).join("+") || "none";
    for (const key of Object.keys(legacyCaps) as (keyof typeof legacyCaps)[]) {
      check(`enrollment.${key}[${on}]`, legacyCaps[key], nextCaps[key]);
    }
  }

  // ------------------------------------------------------------------ Lead
  const legacyLeadActor = legacyLead.buildLeadActor(perms, ME, { isAdmin: legacyLead.isLeadViewAdmin(user) });
  const leadActor = lead.leadActorFromGrants(ME, grants);
  const manages = legacyLead.canManageLeads(legacyLeadActor);
  check("lead.module", legacyLead.canWorkLeads(legacyLeadActor), lead.canWorkLeads(leadActor));
  check("lead.create", manages, lead.canCreateLeads(leadActor));
  check("lead.assign", manages, lead.canAssignLeads(leadActor));
  check("lead.import", manages, lead.canImportLeads(leadActor));
  check("lead.settings", manages, lead.canManageLeadSettings(leadActor));
  check("lead.overview", manages, lead.canReadLeadOverview(leadActor));
  check("lead.columns", manages, lead.canConfigureLeadColumns(leadActor));
  for (const assigned of [ME, OTHER]) {
    for (const isOwnerOrAssistant of assigned === ME ? [true] : [false, true]) {
      const row = { assigned_to_email: assigned };
      const flags = { isOwnerOrAssistant };
      const tag = `${assigned === ME ? "mine" : "agent"}:${isOwnerOrAssistant}`;
      check(`lead.view[${tag}]`, legacyLead.canViewLead(legacyLeadActor, row, flags), lead.canViewLead(leadActor, row, flags));
      check(`lead.edit[${tag}]`, legacyLead.canEditLead(legacyLeadActor, row, flags), lead.canEditLead(leadActor, row, flags));
      check(`lead.log[${tag}]`, legacyLead.canLogInteraction(legacyLeadActor, row, flags), lead.canLogInteraction(leadActor, row, flags));
    }
  }

  // ------------------------------------------------------------------ Export / Import
  // Cũ: task/enrollment export = task.export; provider export = provider_finder +
  // task.export; provider import = provider_finder + task.import; enrollment
  // import = task.import + task manager.
  const legacyExportAny = legacyExport.canActorExport(perms);
  const legacyImport = legacyExport.canActorImport(perms);
  const providerFinder = has(PERMISSIONS.AUTOMATION_PROVIDER_FINDER);
  check("export.task", legacyExportAny, canActorExport(grants, "task"));
  check("export.enrollment", legacyExportAny, canActorExport(grants, "enrollment"));
  check(
    "export.provider",
    providerFinder && legacyExportAny,
    hasGrant(grants, "provider.read") && canActorExport(grants, "provider")
  );
  check(
    "import.provider",
    providerFinder && legacyImport,
    hasGrant(grants, "provider.update") && canActorImport(grants, "provider")
  );
  check(
    "import.enrollment",
    legacyExport.canActorImportEnrollment(perms, legacyTaskActor),
    canActorImport(grants, "enrollment")
  );

  // ------------------------------------------------------------------ Registration / Dashboard
  const viewAll = has(PERMISSIONS.COMPANY_VIEW_ALL);
  for (const [domain, key] of [
    ["health", PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH],
    ["pc", PERMISSIONS.CUSTOMER_REGISTRATION_PC],
  ] as const) {
    check(`registration.${domain}.read`, has(key), hasGrant(grants, `registration.${domain}.read`));
    check(`registration.${domain}.create`, has(key), hasGrant(grants, `registration.${domain}.create`));
    check(`registration.${domain}.update`, has(key), hasGrant(grants, `registration.${domain}.update`));
    check(`registration.${domain}.read_all`, has(key) && viewAll, hasGrant(grants, `registration.${domain}.read`, "all"));
    check(`registration.${domain}.update_all`, has(key) && viewAll, hasGrant(grants, `registration.${domain}.update`, "all"));
  }
  for (const [domain, agentKey, companyKey] of [
    ["health", PERMISSIONS.AGENT_DASHBOARD_HEALTH, PERMISSIONS.COMPANY_DASHBOARD_HEALTH],
    ["pc", PERMISSIONS.AGENT_DASHBOARD_PC, PERMISSIONS.COMPANY_DASHBOARD_PC],
  ] as const) {
    check(`dashboard.${domain}.agent`, has(agentKey), hasGrant(grants, `dashboard.${domain}.agent.read`));
    check(`dashboard.${domain}.company`, has(companyKey), hasGrant(grants, `dashboard.${domain}.company.read`));
    // Trang agent dashboard chỉ mở khi có quyền agent; khi đó view_all = mọi agent.
    check(
      `dashboard.${domain}.all_agents`,
      has(agentKey) && viewAll,
      hasGrant(grants, `dashboard.${domain}.agent.read`, "all")
    );
    check(
      `dashboard.${domain}.company_defaults`,
      has(PERMISSIONS.ROLE_MANAGER) || has(companyKey),
      hasGrant(grants, `dashboard.${domain}.company.defaults.manage`)
    );
  }
  check(
    "dashboard.agent_defaults",
    has(PERMISSIONS.ROLE_MANAGER) || viewAll,
    hasGrant(grants, "dashboard.agent.defaults.manage")
  );

  // ------------------------------------------------------------------ Còn lại
  const simple: [string, boolean, boolean][] = [
    ["automation.health_statement", has(PERMISSIONS.AUTOMATION_HEALTH_STATEMENT), hasGrant(grants, "automation.health_statement.run")],
    ["automation.pc_statement", has(PERMISSIONS.AUTOMATION_PC_STATEMENT), hasGrant(grants, "automation.pc_statement.run")],
    ["provider.read", providerFinder, hasGrant(grants, "provider.read")],
    ["provider.update", providerFinder, hasGrant(grants, "provider.update")],
    ["timeoff.request", has(PERMISSIONS.TIME_OFF_USER) || has(PERMISSIONS.TIME_OFF_ADMIN), hasGrant(grants, "timeoff.request")],
    ["timeoff.manage", has(PERMISSIONS.TIME_OFF_ADMIN), hasGrant(grants, "timeoff.manage")],
    ["settings", has(PERMISSIONS.SETTINGS), hasGrant(grants, "settings.access")],
    ["account.manage", has(PERMISSIONS.ACCOUNT_MANAGER), hasGrant(grants, "account.manage")],
    ["role.manage", has(PERMISSIONS.ROLE_MANAGER), hasGrant(grants, "role.manage")],
    ["org.roster", legacyTaskActor.isManager, hasGrant(grants, "org.agent_roster.manage")],
    // Cũ: SQL assign_unassigned_task + overview-data — task.work, không phải admin.
    [
      "task.queue_member",
      has(PERMISSIONS.TASK_WORK) && !isLegacyAccountAdmin(access),
      hasGrant(grants, "task.queue.member"),
    ],
    ["org.delegation", legacyTaskActor.isManager, hasGrant(grants, "org.assistant_delegation.manage")],
    // Người nhận: task_created = mọi người giữ task.manage; leo thang/QC = cột legacy admin.
    ["notify.task_created", has(PERMISSIONS.TASK_MANAGE), hasGrant(grants, "notify.task.created")],
    ["notify.escalation", access.legacyRole === "admin", hasGrant(grants, "notify.task.escalation")],
    ["notify.enrollment_qc", access.legacyRole === "admin", hasGrant(grants, "notify.enrollment.qc")],
    ["notify.timeoff", has(PERMISSIONS.TIME_OFF_ADMIN), hasGrant(grants, "notify.timeoff.submitted")],
    ["lead.assignable", legacyLeadActor.isWorker, lead.canWorkLeads(leadActor)],
  ];
  for (const [decision, legacy, next] of simple) check(decision, legacy, next);

  return out;
}

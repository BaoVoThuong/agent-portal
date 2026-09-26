/**
 * Danh mục action của lớp phân quyền mới (audit 2026-09-25, plan final §I.3).
 *
 * Một GRANT là cặp `{action, scope}`: role nói người đó được làm LOẠI việc gì, ở
 * PHẠM VI nào. Phạm vi là quan hệ logic; mỗi resource ánh xạ quan hệ đó sang cột
 * của nó (xem `src/lib/authz/relations.ts` và các policy theo domain).
 *
 * File này là NGUỒN DUY NHẤT cho "action nào tồn tại". Role Manager chỉ ghép các
 * action có sẵn; action mới cần code policy + deploy.
 */

export const SCOPES = [
  "own",
  "assigned",
  "reported",
  "participating",
  "agent_owned",
  "assistant_for_agent",
  "shared_queue",
  "all",
] as const;

export type Scope = (typeof SCOPES)[number];

/** Action không phân phạm vi (bật/tắt), ví dụ quyền mở một công cụ. */
export const UNSCOPED = "*" as const;

export type GrantScope = Scope | typeof UNSCOPED;

/** Nhãn hiển thị của scope trong Role Manager. */
export const SCOPE_LABELS: Record<GrantScope, string> = {
  own: "Own",
  assigned: "Assigned to them",
  reported: "Created by them",
  participating: "Mentioned in",
  agent_owned: "Their agent book",
  assistant_for_agent: "Agents they assist",
  shared_queue: "Shared queue",
  all: "All",
  "*": "Allowed",
};

export type ActionDefinition = {
  action: string;
  label: string;
  group: string;
  /** Các scope được phép cấp. `["*"]` = action bật/tắt. */
  scopes: readonly GrantScope[];
  /** Quyền quản trị nhạy cảm: chỉ người đang giữ nó mới cấp được cho người khác. */
  sensitive?: boolean;
  /**
   * Grant "thành viên" mà người QUẢN LÝ không tự giữ (vd admin không nằm trong
   * hàng đợi CS) nhưng vẫn phải cấp được: ai giữ action này thì cấp được grant
   * này dù không giữ nó (trần uỷ quyền, delegation.ts).
   */
  delegatedBy?: string;
  description?: string;
};

const TASK_READ_SCOPES = [
  "assigned",
  "reported",
  "participating",
  "agent_owned",
  "assistant_for_agent",
  "shared_queue",
  "all",
] as const satisfies readonly Scope[];
const OWNER_SCOPES = ["agent_owned", "assistant_for_agent", "all"] as const satisfies readonly Scope[];

export const ACTIONS = [
  // ---------------------------------------------------------------- Task
  { action: "task.read", label: "View tasks", group: "Tasks", scopes: TASK_READ_SCOPES },
  { action: "task.create", label: "Create tasks", group: "Tasks", scopes: OWNER_SCOPES },
  {
    action: "task.content.update",
    label: "Edit task content",
    group: "Tasks",
    scopes: ["reported", "agent_owned", "assistant_for_agent", "all"],
  },
  { action: "task.due_date.update", label: "Change due date", group: "Tasks", scopes: TASK_READ_SCOPES },
  {
    action: "task.status.update",
    label: "Change status / reopen / unlock overdue",
    group: "Tasks",
    scopes: ["assigned", "agent_owned", "assistant_for_agent", "all"],
  },
  { action: "task.assign", label: "Assign tasks", group: "Tasks", scopes: OWNER_SCOPES },
  { action: "task.delete", label: "Delete tasks", group: "Tasks", scopes: OWNER_SCOPES },
  { action: "task.qc_review", label: "QC review tasks", group: "Tasks", scopes: OWNER_SCOPES },
  { action: "task.activity.read", label: "View task activity", group: "Tasks", scopes: OWNER_SCOPES },
  { action: "task.backlog.read", label: "View backlog", group: "Tasks", scopes: [UNSCOPED] },
  {
    action: "task.queue.member",
    label: "Receive tasks from the shared CS queue",
    group: "Tasks",
    scopes: [UNSCOPED],
    delegatedBy: "task.config.manage",
  },
  { action: "task.overview.read", label: "View workload overview", group: "Tasks", scopes: [UNSCOPED] },
  {
    action: "task.config.manage",
    label: "Configure tasks & enrollment (categories, SLA, reminders, columns)",
    group: "Tasks",
    scopes: [UNSCOPED],
  },
  { action: "task.export", label: "Export tasks", group: "Tasks", scopes: [UNSCOPED] },

  // ---------------------------------------------------------------- Enrollment
  {
    action: "enrollment.read",
    label: "View enrollment records",
    group: "Enrollment",
    scopes: ["assigned", "reported", "agent_owned", "assistant_for_agent", "shared_queue", "all"],
  },
  { action: "enrollment.create", label: "Create records", group: "Enrollment", scopes: OWNER_SCOPES },
  {
    action: "enrollment.content.update",
    label: "Edit record content",
    group: "Enrollment",
    scopes: ["reported", "agent_owned", "assistant_for_agent", "all"],
  },
  {
    action: "enrollment.fields.update",
    label: "Edit record fields",
    group: "Enrollment",
    scopes: ["assigned", "reported", "agent_owned", "assistant_for_agent", "all"],
  },
  {
    action: "enrollment.stage.update",
    label: "Change stage / reopen",
    group: "Enrollment",
    scopes: ["assigned", "agent_owned", "assistant_for_agent", "all"],
  },
  { action: "enrollment.qc_review", label: "QC review records", group: "Enrollment", scopes: OWNER_SCOPES },
  { action: "enrollment.people.assign", label: "Assign caller / responsible", group: "Enrollment", scopes: OWNER_SCOPES },
  { action: "enrollment.archive", label: "Archive records", group: "Enrollment", scopes: OWNER_SCOPES },
  {
    action: "enrollment.agent.transfer",
    label: "Move record to another agent",
    group: "Enrollment",
    scopes: ["reported", "agent_owned", "assistant_for_agent", "all"],
  },
  { action: "enrollment.options.manage", label: "Manage option lists", group: "Enrollment", scopes: [UNSCOPED] },
  { action: "enrollment.overview.read", label: "View enrollment overview", group: "Enrollment", scopes: [UNSCOPED] },
  { action: "enrollment.export", label: "Export records", group: "Enrollment", scopes: [UNSCOPED] },
  {
    action: "enrollment.import",
    label: "Import records (bulk overwrite)",
    group: "Enrollment",
    scopes: [UNSCOPED],
    sensitive: true,
  },

  // ---------------------------------------------------------------- Lead
  {
    action: "lead.read",
    label: "View leads",
    group: "Lead Management",
    scopes: ["assigned", "assistant_for_agent", "all"],
  },
  {
    action: "lead.update",
    label: "Edit leads",
    group: "Lead Management",
    scopes: ["assigned", "assistant_for_agent", "all"],
  },
  {
    action: "lead.interaction.log",
    label: "Log interactions",
    group: "Lead Management",
    scopes: ["assigned", "assistant_for_agent", "all"],
  },
  { action: "lead.create", label: "Create leads", group: "Lead Management", scopes: [UNSCOPED] },
  { action: "lead.assign", label: "Assign / distribute leads", group: "Lead Management", scopes: [UNSCOPED] },
  { action: "lead.import", label: "Import leads", group: "Lead Management", scopes: [UNSCOPED] },
  { action: "lead.settings.manage", label: "Lead settings, events, vocabulary", group: "Lead Management", scopes: [UNSCOPED] },
  { action: "lead.overview.read", label: "View lead overview", group: "Lead Management", scopes: [UNSCOPED] },
  { action: "lead.config.manage", label: "Configure lead columns", group: "Lead Management", scopes: [UNSCOPED] },

  // ---------------------------------------------------------------- Registration
  { action: "registration.health.read", label: "View Health registrations", group: "Customer Registration", scopes: ["own", "all"] },
  { action: "registration.health.create", label: "Enter Health registrations", group: "Customer Registration", scopes: [UNSCOPED] },
  { action: "registration.health.update", label: "Edit / delete Health registrations", group: "Customer Registration", scopes: ["own", "all"] },
  { action: "registration.pc.read", label: "View P&C registrations", group: "Customer Registration", scopes: ["own", "all"] },
  { action: "registration.pc.create", label: "Enter P&C registrations", group: "Customer Registration", scopes: [UNSCOPED] },
  { action: "registration.pc.update", label: "Edit / delete P&C registrations", group: "Customer Registration", scopes: ["own", "all"] },

  // ---------------------------------------------------------------- Dashboard
  { action: "dashboard.health.agent.read", label: "Agent dashboard — Health", group: "Dashboard", scopes: ["own", "all"] },
  { action: "dashboard.pc.agent.read", label: "Agent dashboard — P&C", group: "Dashboard", scopes: ["own", "all"] },
  { action: "dashboard.health.company.read", label: "Company dashboard — Health", group: "Dashboard", scopes: [UNSCOPED] },
  { action: "dashboard.pc.company.read", label: "Company dashboard — P&C", group: "Dashboard", scopes: [UNSCOPED] },
  { action: "dashboard.agent.defaults.manage", label: "Edit agent dashboard defaults", group: "Dashboard", scopes: [UNSCOPED] },
  { action: "dashboard.health.company.defaults.manage", label: "Edit company Health defaults", group: "Dashboard", scopes: [UNSCOPED] },
  { action: "dashboard.pc.company.defaults.manage", label: "Edit company P&C defaults", group: "Dashboard", scopes: [UNSCOPED] },

  // ---------------------------------------------------------------- Automation / Provider
  { action: "automation.health_statement.run", label: "Health Statement", group: "Automation", scopes: [UNSCOPED] },
  { action: "automation.pc_statement.run", label: "P&C Statement", group: "Automation", scopes: [UNSCOPED] },
  { action: "provider.read", label: "Use Provider List / Finder", group: "Automation", scopes: [UNSCOPED] },
  { action: "provider.update", label: "Edit Provider List and columns", group: "Automation", scopes: [UNSCOPED] },
  { action: "provider.export", label: "Export Provider List", group: "Automation", scopes: [UNSCOPED] },
  { action: "provider.import", label: "Import Provider List", group: "Automation", scopes: [UNSCOPED], sensitive: true },

  // ---------------------------------------------------------------- Time off
  { action: "timeoff.request", label: "Request time off", group: "Time Off", scopes: [UNSCOPED] },
  { action: "timeoff.manage", label: "Approve time off, manage balances and company days off", group: "Time Off", scopes: [UNSCOPED], sensitive: true },

  // ---------------------------------------------------------------- Org
  { action: "org.agent_roster.manage", label: "Manage agent roster", group: "Organization", scopes: [UNSCOPED], sensitive: true },
  { action: "org.assistant_delegation.manage", label: "Manage agent assistants", group: "Organization", scopes: [UNSCOPED], sensitive: true },

  // ---------------------------------------------------------------- Management
  { action: "account.manage", label: "Account Manager", group: "Management", scopes: [UNSCOPED], sensitive: true },
  { action: "role.manage", label: "Role Manager", group: "Management", scopes: [UNSCOPED], sensitive: true },
  { action: "settings.access", label: "Personal settings", group: "Settings", scopes: [UNSCOPED] },

  // ---------------------------------------------------------------- Notifications (nhóm giám sát)
  { action: "notify.task.created", label: "Notify: new task created", group: "Notifications", scopes: [UNSCOPED] },
  {
    action: "notify.task.escalation",
    label: "Notify: task escalations (urgent backlog, SLA / due date, overdue unlock)",
    group: "Notifications",
    scopes: [UNSCOPED],
  },
  { action: "notify.enrollment.qc", label: "Notify: enrollment QC needed", group: "Notifications", scopes: [UNSCOPED] },
  { action: "notify.enrollment.escalation", label: "Notify: overdue enrollment", group: "Notifications", scopes: [UNSCOPED] },
  { action: "notify.timeoff.submitted", label: "Notify: new time-off request", group: "Notifications", scopes: [UNSCOPED] },
] as const satisfies readonly ActionDefinition[];

export type Action = (typeof ACTIONS)[number]["action"];

const DEFINITION_BY_ACTION = new Map<string, ActionDefinition>(
  ACTIONS.map((definition) => [definition.action, definition])
);

export function getActionDefinition(action: string): ActionDefinition | undefined {
  return DEFINITION_BY_ACTION.get(action);
}

export function isKnownAction(action: string): action is Action {
  return DEFINITION_BY_ACTION.has(action);
}

export function isScopeAllowed(action: string, scope: string): scope is GrantScope {
  const definition = DEFINITION_BY_ACTION.get(action);
  return Boolean(definition && (definition.scopes as readonly string[]).includes(scope));
}

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

export type ActionDefinition = {
  action: string;
  label: string;
  group: string;
  /** Các scope được phép cấp. `["*"]` = action bật/tắt. */
  scopes: readonly GrantScope[];
  /** Quyền quản trị nhạy cảm: chỉ người đang giữ nó mới cấp được cho người khác. */
  sensitive?: boolean;
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
  { action: "task.read", label: "Xem task", group: "Tasks", scopes: TASK_READ_SCOPES },
  { action: "task.create", label: "Tạo task", group: "Tasks", scopes: OWNER_SCOPES },
  {
    action: "task.content.update",
    label: "Sửa nội dung task",
    group: "Tasks",
    scopes: ["reported", "agent_owned", "assistant_for_agent", "all"],
  },
  { action: "task.due_date.update", label: "Dời Due Date", group: "Tasks", scopes: TASK_READ_SCOPES },
  {
    action: "task.status.update",
    label: "Đổi trạng thái / reopen / mở khoá quá hạn",
    group: "Tasks",
    scopes: ["assigned", "agent_owned", "assistant_for_agent", "all"],
  },
  { action: "task.assign", label: "Giao việc", group: "Tasks", scopes: OWNER_SCOPES },
  { action: "task.delete", label: "Xoá task", group: "Tasks", scopes: OWNER_SCOPES },
  { action: "task.qc_review", label: "QC task", group: "Tasks", scopes: OWNER_SCOPES },
  { action: "task.activity.read", label: "Xem lịch sử task", group: "Tasks", scopes: OWNER_SCOPES },
  { action: "task.backlog.read", label: "Xem Backlog", group: "Tasks", scopes: [UNSCOPED] },
  { action: "task.overview.read", label: "Xem Overview workload", group: "Tasks", scopes: [UNSCOPED] },
  {
    action: "task.config.manage",
    label: "Cấu hình Task/Enrollment (category, SLA, nhắc việc, cột bảng)",
    group: "Tasks",
    scopes: [UNSCOPED],
  },
  { action: "task.export", label: "Export task", group: "Tasks", scopes: [UNSCOPED] },

  // ---------------------------------------------------------------- Enrollment
  {
    action: "enrollment.read",
    label: "Xem hồ sơ Enrollment",
    group: "Enrollment",
    scopes: ["assigned", "reported", "agent_owned", "assistant_for_agent", "shared_queue", "all"],
  },
  { action: "enrollment.create", label: "Tạo hồ sơ", group: "Enrollment", scopes: OWNER_SCOPES },
  {
    action: "enrollment.content.update",
    label: "Sửa nội dung hồ sơ",
    group: "Enrollment",
    scopes: ["reported", "agent_owned", "assistant_for_agent", "all"],
  },
  {
    action: "enrollment.fields.update",
    label: "Sửa trường hồ sơ",
    group: "Enrollment",
    scopes: ["assigned", "reported", "agent_owned", "assistant_for_agent", "all"],
  },
  {
    action: "enrollment.stage.update",
    label: "Đổi stage / reopen",
    group: "Enrollment",
    scopes: ["assigned", "agent_owned", "assistant_for_agent", "all"],
  },
  { action: "enrollment.qc_review", label: "QC hồ sơ", group: "Enrollment", scopes: OWNER_SCOPES },
  { action: "enrollment.people.assign", label: "Giao người phụ trách", group: "Enrollment", scopes: OWNER_SCOPES },
  { action: "enrollment.archive", label: "Lưu trữ hồ sơ", group: "Enrollment", scopes: OWNER_SCOPES },
  {
    action: "enrollment.agent.transfer",
    label: "Chuyển hồ sơ sang agent khác",
    group: "Enrollment",
    scopes: ["reported", "agent_owned", "assistant_for_agent", "all"],
  },
  { action: "enrollment.options.manage", label: "Quản lý danh sách lựa chọn", group: "Enrollment", scopes: [UNSCOPED] },
  { action: "enrollment.overview.read", label: "Xem Overview Enrollment", group: "Enrollment", scopes: [UNSCOPED] },
  { action: "enrollment.export", label: "Export hồ sơ", group: "Enrollment", scopes: [UNSCOPED] },
  {
    action: "enrollment.import",
    label: "Import hồ sơ (ghi đè hàng loạt)",
    group: "Enrollment",
    scopes: [UNSCOPED],
    sensitive: true,
  },

  // ---------------------------------------------------------------- Lead
  {
    action: "lead.read",
    label: "Xem lead",
    group: "Lead Management",
    scopes: ["assigned", "assistant_for_agent", "all"],
  },
  {
    action: "lead.update",
    label: "Sửa lead",
    group: "Lead Management",
    scopes: ["assigned", "assistant_for_agent", "all"],
  },
  {
    action: "lead.interaction.log",
    label: "Ghi tương tác",
    group: "Lead Management",
    scopes: ["assigned", "assistant_for_agent", "all"],
  },
  { action: "lead.create", label: "Tạo lead", group: "Lead Management", scopes: [UNSCOPED] },
  { action: "lead.assign", label: "Giao / chia lead", group: "Lead Management", scopes: [UNSCOPED] },
  { action: "lead.import", label: "Import lead", group: "Lead Management", scopes: [UNSCOPED] },
  { action: "lead.settings.manage", label: "Cài đặt lead, sự kiện, từ vựng", group: "Lead Management", scopes: [UNSCOPED] },
  { action: "lead.overview.read", label: "Xem Overview lead", group: "Lead Management", scopes: [UNSCOPED] },
  { action: "lead.config.manage", label: "Cấu hình cột bảng lead", group: "Lead Management", scopes: [UNSCOPED] },

  // ---------------------------------------------------------------- Registration
  { action: "registration.health.read", label: "Xem Health Registration", group: "Customer Registration", scopes: ["own", "all"] },
  { action: "registration.health.create", label: "Nhập Health Registration", group: "Customer Registration", scopes: [UNSCOPED] },
  { action: "registration.health.update", label: "Sửa/xoá Health Registration", group: "Customer Registration", scopes: ["own", "all"] },
  { action: "registration.pc.read", label: "Xem P&C Registration", group: "Customer Registration", scopes: ["own", "all"] },
  { action: "registration.pc.create", label: "Nhập P&C Registration", group: "Customer Registration", scopes: [UNSCOPED] },
  { action: "registration.pc.update", label: "Sửa/xoá P&C Registration", group: "Customer Registration", scopes: ["own", "all"] },

  // ---------------------------------------------------------------- Dashboard
  { action: "dashboard.health.agent.read", label: "Agent Dashboard Health", group: "Dashboard", scopes: ["own", "all"] },
  { action: "dashboard.pc.agent.read", label: "Agent Dashboard P&C", group: "Dashboard", scopes: ["own", "all"] },
  { action: "dashboard.health.company.read", label: "Company Dashboard Health", group: "Dashboard", scopes: [UNSCOPED] },
  { action: "dashboard.pc.company.read", label: "Company Dashboard P&C", group: "Dashboard", scopes: [UNSCOPED] },
  { action: "dashboard.agent.defaults.manage", label: "Sửa mặc định Agent Dashboard", group: "Dashboard", scopes: [UNSCOPED] },
  { action: "dashboard.health.company.defaults.manage", label: "Sửa mặc định Company Health", group: "Dashboard", scopes: [UNSCOPED] },
  { action: "dashboard.pc.company.defaults.manage", label: "Sửa mặc định Company P&C", group: "Dashboard", scopes: [UNSCOPED] },

  // ---------------------------------------------------------------- Automation / Provider
  { action: "automation.health_statement.run", label: "Health Statement", group: "Automation", scopes: [UNSCOPED] },
  { action: "automation.pc_statement.run", label: "P&C Statement", group: "Automation", scopes: [UNSCOPED] },
  { action: "provider.read", label: "Xem Provider List / Finder", group: "Automation", scopes: [UNSCOPED] },
  { action: "provider.update", label: "Sửa Provider List và cột bảng", group: "Automation", scopes: [UNSCOPED] },
  { action: "provider.export", label: "Export Provider List", group: "Automation", scopes: [UNSCOPED] },
  { action: "provider.import", label: "Import Provider List", group: "Automation", scopes: [UNSCOPED], sensitive: true },

  // ---------------------------------------------------------------- Time off
  { action: "timeoff.request", label: "Xin nghỉ phép", group: "Time Off", scopes: [UNSCOPED] },
  { action: "timeoff.manage", label: "Duyệt nghỉ, quản số dư, ngày nghỉ công ty", group: "Time Off", scopes: [UNSCOPED], sensitive: true },

  // ---------------------------------------------------------------- Org
  { action: "org.agent_roster.manage", label: "Quản danh sách Agent", group: "Organization", scopes: [UNSCOPED], sensitive: true },
  { action: "org.assistant_delegation.manage", label: "Quản Assistant của Agent", group: "Organization", scopes: [UNSCOPED], sensitive: true },

  // ---------------------------------------------------------------- Management
  { action: "account.manage", label: "Account Manager", group: "Management", scopes: [UNSCOPED], sensitive: true },
  { action: "role.manage", label: "Role Manager", group: "Management", scopes: [UNSCOPED], sensitive: true },
  { action: "settings.access", label: "Settings cá nhân", group: "Settings", scopes: [UNSCOPED] },

  // ---------------------------------------------------------------- Notifications (nhóm giám sát)
  { action: "notify.task.created", label: "Nhận thông báo task mới", group: "Notifications", scopes: [UNSCOPED] },
  {
    action: "notify.task.escalation",
    label: "Nhận leo thang task (backlog khẩn, quá SLA/Due Date, mở khoá quá hạn)",
    group: "Notifications",
    scopes: [UNSCOPED],
  },
  { action: "notify.enrollment.qc", label: "Nhận thông báo QC hồ sơ", group: "Notifications", scopes: [UNSCOPED] },
  { action: "notify.enrollment.escalation", label: "Nhận leo thang hồ sơ quá hạn", group: "Notifications", scopes: [UNSCOPED] },
  { action: "notify.timeoff.submitted", label: "Nhận đơn nghỉ mới", group: "Notifications", scopes: [UNSCOPED] },
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

export const PERMISSIONS = {
  CUSTOMER_REGISTRATION_HEALTH: "customer_registration.health",
  CUSTOMER_REGISTRATION_PC: "customer_registration.pc",
  CUSTOMER_REGISTRATION_VIEW_ALL: "customer_registration.view_all",
  AUTOMATION_HEALTH_STATEMENT: "automation.health_statement",
  AUTOMATION_PC_STATEMENT: "automation.pc_statement",
  AUTOMATION_PROVIDER_FINDER: "automation.provider_finder",
  AUTOMATION_PROVIDER_MANAGE: "automation.provider_manage",
  AGENT_DASHBOARD_HEALTH: "agent_dashboard.health",
  AGENT_DASHBOARD_PC: "agent_dashboard.pc",
  COMPANY_DASHBOARD_HEALTH: "company_dashboard.health",
  COMPANY_DASHBOARD_PC: "company_dashboard.pc",
  COMPANY_VIEW_ALL: "company.view_all",
  ACCOUNT_MANAGER: "management.account_manager",
  NOTIFICATION_ALERTS: "management.notification_alerts",
  ROLE_MANAGER: "management.role_manager",
  TIME_OFF_USER: "timeoff.user",
  TIME_OFF_ADMIN: "timeoff.admin",
  TASK_MANAGE: "task.manage",
  TASK_WORK: "task.work",
  TASK_EXPORT: "task.export",
  TASK_IMPORT: "task.import",
  LEAD_MANAGE: "lead.manage",
  LEAD_WORK: "lead.work",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Keep legacy DB/JWT rows readable while Settings becomes universal to signed-in accounts.
export function isAssignablePermissionKey(key: string): boolean {
  return key !== "settings.access";
}

export type PermissionDefinition = {
  key: PermissionKey;
  label: string;
  groupKey: string;
  groupLabel: string;
  description?: string;
  sortOrder: number;
};

/**
 * Manage bao gồm Work. Role có Manage thì không lưu Work: tick cả hai chỉ gây
 * hiểu nhầm — người có `task.manage` + `task.work` từng bị chia task CS như CS
 * thường, dù đã là manager.
 */
export const IMPLIED_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  [PERMISSIONS.TASK_MANAGE]: [PERMISSIONS.TASK_WORK],
  [PERMISSIONS.LEAD_MANAGE]: [PERMISSIONS.LEAD_WORK],
};

/** Bỏ các quyền đã được một quyền khác bao gồm. Dùng khi LƯU quyền của role. */
export function normalizeExclusivePermissionKeys(permissionKeys: string[]) {
  const keys = new Set(permissionKeys);
  for (const [manage, implied] of Object.entries(IMPLIED_PERMISSIONS)) {
    if (keys.has(manage)) for (const key of implied) keys.delete(key);
  }
  return [...keys];
}

/** Thêm các quyền được bao gồm. Dùng khi SO quyền (trần uỷ quyền). */
export function expandImpliedPermissions(permissionKeys: readonly string[]): string[] {
  const keys = new Set(permissionKeys);
  for (const [manage, implied] of Object.entries(IMPLIED_PERMISSIONS)) {
    if (keys.has(manage)) for (const key of implied) keys.add(key);
  }
  return [...keys];
}

/** Quyền nào (nếu có) đang bao gồm `key`. */
export function permissionImpliedBy(key: string): string | null {
  for (const [manage, implied] of Object.entries(IMPLIED_PERMISSIONS)) {
    if (implied.includes(key)) return manage;
  }
  return null;
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    key: PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH,
    label: "Health Registration",
    groupKey: "customer_registration",
    groupLabel: "Customer Registration",
    description: "View and manage Health registration records.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.CUSTOMER_REGISTRATION_PC,
    label: "P&C Registration",
    groupKey: "customer_registration",
    groupLabel: "Customer Registration",
    description: "View and manage P&C registration records.",
    sortOrder: 200,
  },
  {
    key: PERMISSIONS.CUSTOMER_REGISTRATION_VIEW_ALL,
    label: "Registration - View All Agents",
    groupKey: "customer_registration",
    groupLabel: "Customer Registration",
    description: "See every agent's entries in Health and P&C Customer Registration.",
    sortOrder: 300,
  },
  {
    key: PERMISSIONS.AUTOMATION_HEALTH_STATEMENT,
    label: "Health Statement",
    groupKey: "automation",
    groupLabel: "Automation",
    description: "Access and run the Health Statement tool.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.AUTOMATION_PC_STATEMENT,
    label: "P&C Statement",
    groupKey: "automation",
    groupLabel: "Automation",
    description: "Access and run the P&C Statement tool.",
    sortOrder: 200,
  },
  {
    key: PERMISSIONS.AUTOMATION_PROVIDER_FINDER,
    label: "Provider Finder",
    groupKey: "automation",
    groupLabel: "Automation",
    description: "Access and run the Provider Finder tool.",
    sortOrder: 300,
  },
  {
    key: PERMISSIONS.AUTOMATION_PROVIDER_MANAGE,
    label: "Provider List - Manage",
    groupKey: "automation",
    groupLabel: "Automation",
    description:
      "Add and delete provider addresses, change the Provider List columns, and export / import the Provider List. Needs Provider Finder as well.",
    sortOrder: 350,
  },
  {
    key: PERMISSIONS.AGENT_DASHBOARD_HEALTH,
    label: "Agent - Health",
    groupKey: "dashboard",
    groupLabel: "Dashboard",
    description: "View Health dashboard. Scope limited to own data unless View All Agents is granted.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.AGENT_DASHBOARD_PC,
    label: "Agent - P&C",
    groupKey: "dashboard",
    groupLabel: "Dashboard",
    description: "View P&C dashboard. Scope limited to own data unless View All Agents is granted.",
    sortOrder: 200,
  },
  {
    key: PERMISSIONS.COMPANY_DASHBOARD_HEALTH,
    label: "Company - Health",
    groupKey: "dashboard",
    groupLabel: "Dashboard",
    description: "View the company-wide Health Sales Dashboard.",
    sortOrder: 300,
  },
  {
    key: PERMISSIONS.COMPANY_DASHBOARD_PC,
    label: "Company - P&C",
    groupKey: "dashboard",
    groupLabel: "Dashboard",
    description: "View the company-wide P&C Sales Dashboard.",
    sortOrder: 400,
  },
  {
    key: PERMISSIONS.COMPANY_VIEW_ALL,
    label: "View All Agents",
    groupKey: "dashboard",
    groupLabel: "Dashboard",
    description: "See all agents' data in the Agent Dashboard.",
    sortOrder: 500,
  },
  {
    key: PERMISSIONS.ACCOUNT_MANAGER,
    label: "Account Manager",
    groupKey: "management",
    groupLabel: "Management",
    description:
      "Create accounts, assign roles, update status, reset passwords, and manage Agents and Assistants.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.NOTIFICATION_ALERTS,
    label: "Notification Alerts",
    groupKey: "management",
    groupLabel: "Management",
    description:
      "Turn notification sounds, pop-ups and push on or off for each user. Mentions and assignments still alert.",
    sortOrder: 150,
  },
  {
    key: PERMISSIONS.ROLE_MANAGER,
    label: "Role Manager",
    groupKey: "management",
    groupLabel: "Management",
    description: "Create roles and manage role permissions.",
    sortOrder: 200,
  },
  {
    key: PERMISSIONS.TIME_OFF_USER,
    label: "Time Off - User",
    groupKey: "time_off",
    groupLabel: "Time Off",
    description: "Request personal leave, view own requests, and see the shared availability calendar.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.TIME_OFF_ADMIN,
    label: "Time Off - Admin",
    groupKey: "time_off",
    groupLabel: "Time Off",
    description: "Review team leave, manage balances, view leave history, and manage company days off.",
    sortOrder: 200,
  },
  {
    key: PERMISSIONS.TASK_MANAGE,
    label: "Tasks - Manage",
    groupKey: "tasks",
    groupLabel: "Tasks",
    description:
      "Full control of Health CS tasks and Enrollment: every record, the backlog, create, assign, delete, CS Overview, SLA and table configuration. Includes Tasks - Work.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.TASK_WORK,
    label: "Tasks - Work",
    groupKey: "tasks",
    groupLabel: "Tasks",
    description:
      "Work on Health CS tasks and Enrollment records you are part of. Puts you in the CS assignment pool.",
    sortOrder: 200,
  },
  {
    key: PERMISSIONS.TASK_EXPORT,
    label: "Tasks - Export",
    groupKey: "tasks",
    groupLabel: "Tasks",
    description: "Export the Health CS task and Enrollment tables to Excel.",
    sortOrder: 300,
  },
  {
    key: PERMISSIONS.TASK_IMPORT,
    label: "Tasks - Import",
    groupKey: "tasks",
    groupLabel: "Tasks",
    description:
      "Import Enrollment tables from Excel. Separate from Export because it overwrites rows in bulk.",
    sortOrder: 350,
  },
  {
    key: PERMISSIONS.LEAD_MANAGE,
    label: "Manage Leads",
    groupKey: "leads",
    groupLabel: "Lead Management",
    description:
      "Import, assign and manage every lead, Lead settings and the Lead table configuration. Includes Work Leads.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.LEAD_WORK,
    label: "Work Leads",
    groupKey: "leads",
    groupLabel: "Lead Management",
    description: "See and log interactions on leads assigned to you.",
    sortOrder: 200,
  },
];

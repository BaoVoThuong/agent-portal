export const PERMISSIONS = {
  CUSTOMER_REGISTRATION_HEALTH: "customer_registration.health",
  CUSTOMER_REGISTRATION_PC: "customer_registration.pc",
  AUTOMATION_HEALTH_STATEMENT: "automation.health_statement",
  AUTOMATION_PC_STATEMENT: "automation.pc_statement",
  AUTOMATION_PROVIDER_FINDER: "automation.provider_finder",
  AGENT_DASHBOARD_HEALTH: "agent_dashboard.health",
  AGENT_DASHBOARD_PC: "agent_dashboard.pc",
  COMPANY_DASHBOARD_HEALTH: "company_dashboard.health",
  COMPANY_DASHBOARD_PC: "company_dashboard.pc",
  COMPANY_VIEW_ALL: "company.view_all",
  ACCOUNT_MANAGER: "management.account_manager",
  ROLE_MANAGER: "management.role_manager",
  SETTINGS: "settings.access",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type PermissionDefinition = {
  key: PermissionKey;
  label: string;
  groupKey: string;
  groupLabel: string;
  description?: string;
  sortOrder: number;
};

export function normalizeExclusivePermissionKeys(permissionKeys: string[]) {
  return [...new Set(permissionKeys)];
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
    description: "See all agents' data in Agent Dashboard and Customer Registration.",
    sortOrder: 500,
  },
  {
    key: PERMISSIONS.ACCOUNT_MANAGER,
    label: "Account Manager",
    groupKey: "management",
    groupLabel: "Management",
    description: "Create accounts, assign roles, update status, and reset passwords.",
    sortOrder: 100,
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
    key: PERMISSIONS.SETTINGS,
    label: "Settings",
    groupKey: "settings",
    groupLabel: "Settings",
    description: "Access account settings and change own password.",
    sortOrder: 100,
  },
];

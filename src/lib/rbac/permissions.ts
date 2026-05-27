export const PERMISSIONS = {
  CUSTOMER_REGISTRATION_HEALTH_OWN: "customer_registration.health.own",
  CUSTOMER_REGISTRATION_HEALTH_ALL: "customer_registration.health.all",
  CUSTOMER_REGISTRATION_PC_OWN: "customer_registration.pc.own",
  CUSTOMER_REGISTRATION_PC_ALL: "customer_registration.pc.all",
  CUSTOMER_REGISTRATION_LIFE_OWN: "customer_registration.life.own",
  CUSTOMER_REGISTRATION_LIFE_ALL: "customer_registration.life.all",
  AUTOMATION_HEALTH_STATEMENT: "automation.health_statement",
  AUTOMATION_PC_STATEMENT: "automation.pc_statement",
  AUTOMATION_PROVIDER_FINDER: "automation.provider_finder",
  DASHBOARD_OWN: "dashboard.own",
  DASHBOARD_ALL: "dashboard.all",
  AGENT_DASHBOARD_HEALTH_OWN: "agent_dashboard.health.own",
  AGENT_DASHBOARD_HEALTH_ALL: "agent_dashboard.health.all",
  AGENT_DASHBOARD_PC_OWN: "agent_dashboard.pc.own",
  AGENT_DASHBOARD_PC_ALL: "agent_dashboard.pc.all",
  AGENT_DASHBOARD_LIFE_OWN: "agent_dashboard.life.own",
  AGENT_DASHBOARD_LIFE_ALL: "agent_dashboard.life.all",
  SALES_DASHBOARD_ACCESS: "sales_dashboard.access",
  ACCOUNT_MANAGER: "management.account_manager",
  ROLE_MANAGER: "management.role_manager",
  SETTINGS: "settings.access",
  SYSTEM_SYNC_DATA: "system.sync_data",
  SYSTEM_VIEW_SENSITIVE_DATA: "system.view_sensitive_data",
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

export function getExclusivePermissionCounterpart(permissionKey: string) {
  if (permissionKey.endsWith(".own")) {
    return permissionKey.replace(/\.own$/, ".all");
  }

  if (permissionKey.endsWith(".all")) {
    return permissionKey.replace(/\.all$/, ".own");
  }

  return null;
}

export function normalizeExclusivePermissionKeys(permissionKeys: string[]) {
  const selected = new Set(permissionKeys);

  for (const permissionKey of permissionKeys) {
    if (!permissionKey.endsWith(".all")) continue;

    const ownPermissionKey = getExclusivePermissionCounterpart(permissionKey);
    if (ownPermissionKey) selected.delete(ownPermissionKey);
  }

  return [
    ...new Set(
      permissionKeys.filter((permissionKey) => selected.has(permissionKey))
    ),
  ];
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    key: PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH_OWN,
    label: "Health Registration - Own",
    groupKey: "customer_registration",
    groupLabel: "Customer Registration",
    description: "View and manage the user's own Health registration records.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH_ALL,
    label: "Health Registration - All",
    groupKey: "customer_registration",
    groupLabel: "Customer Registration",
    description: "View and manage all Health registration records.",
    sortOrder: 110,
  },
  {
    key: PERMISSIONS.CUSTOMER_REGISTRATION_PC_OWN,
    label: "P&C Registration - Own",
    groupKey: "customer_registration",
    groupLabel: "Customer Registration",
    description: "View and manage the user's own P&C registration records.",
    sortOrder: 200,
  },
  {
    key: PERMISSIONS.CUSTOMER_REGISTRATION_PC_ALL,
    label: "P&C Registration - All",
    groupKey: "customer_registration",
    groupLabel: "Customer Registration",
    description: "View and manage all P&C registration records.",
    sortOrder: 210,
  },
  {
    key: PERMISSIONS.CUSTOMER_REGISTRATION_LIFE_OWN,
    label: "Life Registration - Own",
    groupKey: "customer_registration",
    groupLabel: "Customer Registration",
    description: "View and manage the user's own Life registration records.",
    sortOrder: 300,
  },
  {
    key: PERMISSIONS.CUSTOMER_REGISTRATION_LIFE_ALL,
    label: "Life Registration - All",
    groupKey: "customer_registration",
    groupLabel: "Customer Registration",
    description: "View and manage all Life registration records.",
    sortOrder: 310,
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
    key: PERMISSIONS.DASHBOARD_OWN,
    label: "Dashboard - Own",
    groupKey: "dashboard",
    groupLabel: "Dashboard",
    description: "View the user's own dashboard data.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.DASHBOARD_ALL,
    label: "Dashboard - All",
    groupKey: "dashboard",
    groupLabel: "Dashboard",
    description: "View dashboard data for all users.",
    sortOrder: 110,
  },
  {
    key: PERMISSIONS.AGENT_DASHBOARD_HEALTH_OWN,
    label: "Agent Health Dashboard - Own",
    groupKey: "agent_dashboard",
    groupLabel: "Agent Dashboard",
    description: "View the user's own Health agent dashboard data.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.AGENT_DASHBOARD_HEALTH_ALL,
    label: "Agent Health Dashboard - All",
    groupKey: "agent_dashboard",
    groupLabel: "Agent Dashboard",
    description: "View Health agent dashboard data for all users.",
    sortOrder: 110,
  },
  {
    key: PERMISSIONS.AGENT_DASHBOARD_PC_OWN,
    label: "Agent P&C Dashboard - Own",
    groupKey: "agent_dashboard",
    groupLabel: "Agent Dashboard",
    description: "View the user's own P&C agent dashboard data.",
    sortOrder: 200,
  },
  {
    key: PERMISSIONS.AGENT_DASHBOARD_PC_ALL,
    label: "Agent P&C Dashboard - All",
    groupKey: "agent_dashboard",
    groupLabel: "Agent Dashboard",
    description: "View P&C agent dashboard data for all users.",
    sortOrder: 210,
  },
  {
    key: PERMISSIONS.AGENT_DASHBOARD_LIFE_OWN,
    label: "Agent Life Dashboard - Own",
    groupKey: "agent_dashboard",
    groupLabel: "Agent Dashboard",
    description: "View the user's own Life agent dashboard data.",
    sortOrder: 300,
  },
  {
    key: PERMISSIONS.AGENT_DASHBOARD_LIFE_ALL,
    label: "Agent Life Dashboard - All",
    groupKey: "agent_dashboard",
    groupLabel: "Agent Dashboard",
    description: "View Life agent dashboard data for all users.",
    sortOrder: 310,
  },
  {
    key: PERMISSIONS.SALES_DASHBOARD_ACCESS,
    label: "Sales Dashboard",
    groupKey: "sales_dashboard",
    groupLabel: "Sales Dashboard",
    description: "View all Sales Dashboard pages.",
    sortOrder: 100,
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
  {
    key: PERMISSIONS.SYSTEM_SYNC_DATA,
    label: "Data Sync",
    groupKey: "system",
    groupLabel: "System",
    description: "Run data synchronization jobs.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.SYSTEM_VIEW_SENSITIVE_DATA,
    label: "Sensitive Data",
    groupKey: "system",
    groupLabel: "System",
    description: "View sensitive portal data.",
    sortOrder: 110,
  },
];

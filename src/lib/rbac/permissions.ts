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
  PERFORMANCE_OWN: "performance.own",
  PERFORMANCE_ALL: "performance.all",
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
    key: PERMISSIONS.PERFORMANCE_OWN,
    label: "Performance - Own",
    groupKey: "performance",
    groupLabel: "Performance",
    description: "View the user's own performance data.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.PERFORMANCE_ALL,
    label: "Performance - All",
    groupKey: "performance",
    groupLabel: "Performance",
    description: "View performance data for all users.",
    sortOrder: 110,
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

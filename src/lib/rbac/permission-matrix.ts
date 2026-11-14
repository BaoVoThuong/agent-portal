import { PERMISSIONS } from "./permissions";

/**
 * Where each permission sits in the Role Manager matrix (2026-10-31). Layout
 * only — it decides nothing about access. Lives in lib/rbac beside the catalog
 * because it names every module's keys; the Role Manager page may not
 * (rbac/module-boundaries.test.ts).
 */
export type LevelRow = {
  name: string;
  low: string;
  high: string;
  lowLabel: string;
  highLabel: string;
  extras?: Array<{ key: string; column: "export" | "import" }>;
};

export const LEVEL_ROWS: LevelRow[] = [
  {
    name: "Health CS & Enrollment",
    low: PERMISSIONS.TASK_WORK,
    high: PERMISSIONS.TASK_MANAGE,
    lowLabel: "Work",
    highLabel: "Manage",
    extras: [
      { key: PERMISSIONS.TASK_EXPORT, column: "export" },
      { key: PERMISSIONS.TASK_IMPORT, column: "import" },
    ],
  },
  {
    name: "Lead Management",
    low: PERMISSIONS.LEAD_WORK,
    high: PERMISSIONS.LEAD_MANAGE,
    lowLabel: "Work",
    highLabel: "Manage",
    extras: [
      { key: PERMISSIONS.LEAD_EXPORT, column: "export" },
      { key: PERMISSIONS.LEAD_IMPORT, column: "import" },
    ],
  },
  {
    name: "Provider List",
    low: PERMISSIONS.AUTOMATION_PROVIDER_FINDER,
    high: PERMISSIONS.AUTOMATION_PROVIDER_MANAGE,
    lowLabel: "Work",
    highLabel: "Manage",
    extras: [
      { key: PERMISSIONS.AUTOMATION_PROVIDER_EXPORT, column: "export" },
      { key: PERMISSIONS.AUTOMATION_PROVIDER_IMPORT, column: "import" },
    ],
  },
  {
    name: "Time Off",
    low: PERMISSIONS.TIME_OFF_USER,
    high: PERMISSIONS.TIME_OFF_ADMIN,
    lowLabel: "User",
    highLabel: "Admin",
  },
  {
    name: "State Licensing",
    low: PERMISSIONS.HEALTH_LICENSING_VIEW,
    high: PERMISSIONS.HEALTH_LICENSING_MANAGE,
    lowLabel: "View",
    highLabel: "Manage",
  },
];

/** Single-tick tools, listed under Modules → Statement Tool (2026-11-01). */
export const AUTOMATION_TOOL_KEYS = [PERMISSIONS.AUTOMATION_HEALTH_STATEMENT, PERMISSIONS.AUTOMATION_PC_STATEMENT];

export const LINE_COLUMNS = ["Registration", "Agent dashboard", "Company dashboard"] as const;
export const LINE_ROWS: Array<{ name: string; keys: [string, string, string] }> = [
  {
    name: "Health",
    keys: [
      PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH,
      PERMISSIONS.AGENT_DASHBOARD_HEALTH,
      PERMISSIONS.COMPANY_DASHBOARD_HEALTH,
    ],
  },
  {
    name: "P&C",
    keys: [
      PERMISSIONS.CUSTOMER_REGISTRATION_PC,
      PERMISSIONS.AGENT_DASHBOARD_PC,
      PERMISSIONS.COMPANY_DASHBOARD_PC,
    ],
  },
];
/** "All agents" switches: one per column, shared by Health and P&C. */
export const LINE_SCOPES: Partial<Record<(typeof LINE_COLUMNS)[number], string>> = {
  Registration: PERMISSIONS.CUSTOMER_REGISTRATION_VIEW_ALL,
  "Agent dashboard": PERMISSIONS.COMPANY_VIEW_ALL,
};

export const ADMIN_KEYS = [PERMISSIONS.ACCOUNT_MANAGER, PERMISSIONS.ROLE_MANAGER];

export const PLACED_PERMISSION_KEYS: ReadonlySet<string> = new Set<string>([
  ...LEVEL_ROWS.flatMap((row) => [row.low, row.high, ...(row.extras ?? []).map((extra) => extra.key)]),
  ...AUTOMATION_TOOL_KEYS,
  ...LINE_ROWS.flatMap((row) => row.keys),
  ...Object.values(LINE_SCOPES),
  ...ADMIN_KEYS,
]);

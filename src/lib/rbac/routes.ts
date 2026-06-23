import { PERMISSIONS } from "@/lib/rbac/permissions";
import { can, canAny } from "@/lib/rbac/client";

type PermissionRoute = {
  href: string;
  permission?: string;
  anyPermission?: string[];
};

const ACCESSIBLE_ROUTES: PermissionRoute[] = [
  {
    href: "/",
    permission: PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH,
  },
  {
    href: "/customer-registration/pc",
    permission: PERMISSIONS.CUSTOMER_REGISTRATION_PC,
  },
  {
    href: "/automation/health-statement",
    permission: PERMISSIONS.AUTOMATION_HEALTH_STATEMENT,
  },
  {
    href: "/automation/pc-statement",
    permission: PERMISSIONS.AUTOMATION_PC_STATEMENT,
  },
  {
    href: "/automation/provider-finder",
    permission: PERMISSIONS.AUTOMATION_PROVIDER_FINDER,
  },
  {
    href: "/dashboard/health",
    anyPermission: [
      PERMISSIONS.AGENT_DASHBOARD_HEALTH,
      PERMISSIONS.COMPANY_DASHBOARD_HEALTH,
    ],
  },
  {
    href: "/dashboard/pc",
    anyPermission: [
      PERMISSIONS.AGENT_DASHBOARD_PC,
      PERMISSIONS.COMPANY_DASHBOARD_PC,
    ],
  },
  {
    href: "/tasks",
    anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK],
  },
  {
    href: "/account-manager",
    permission: PERMISSIONS.ACCOUNT_MANAGER,
  },
  {
    href: "/role-manager",
    permission: PERMISSIONS.ROLE_MANAGER,
  },
  {
    href: "/settings",
    permission: PERMISSIONS.SETTINGS,
  },
];

export function getFirstAccessiblePath(permissions: readonly string[]) {
  const route = ACCESSIBLE_ROUTES.find((item) => {
    if (item.permission) return can(permissions, item.permission);
    if (item.anyPermission) return canAny(permissions, item.anyPermission);
    return false;
  });

  return route?.href ?? "/unauthorized";
}

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
    anyPermission: [
      PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH_OWN,
      PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH_ALL,
    ],
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
    href: "/performance/health",
    anyPermission: [
      PERMISSIONS.AGENT_PERFORMANCE_HEALTH_OWN,
      PERMISSIONS.AGENT_PERFORMANCE_HEALTH_ALL,
    ],
  },
  {
    href: "/performance/pc",
    anyPermission: [
      PERMISSIONS.AGENT_PERFORMANCE_PC_OWN,
      PERMISSIONS.AGENT_PERFORMANCE_PC_ALL,
    ],
  },
  {
    href: "/performance/life",
    anyPermission: [
      PERMISSIONS.AGENT_PERFORMANCE_LIFE_OWN,
      PERMISSIONS.AGENT_PERFORMANCE_LIFE_ALL,
    ],
  },
  {
    href: "/sales-performance/health",
    permission: PERMISSIONS.SALES_PERFORMANCE_ACCESS,
  },
  {
    href: "/sales-performance/pc",
    permission: PERMISSIONS.SALES_PERFORMANCE_ACCESS,
  },
  {
    href: "/sales-performance/life",
    permission: PERMISSIONS.SALES_PERFORMANCE_ACCESS,
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

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
    // Provider Finder đã gộp thành tab bên trong Provider List, nên chỉ còn một
    // đích cho quyền này. Bỏ mục cũ khỏi đây là cần thiết, không chỉ để dọn:
    // `getFirstAccessiblePath` lấy mục ĐẦU TIÊN khớp quyền, nên nếu để lại thì
    // người chỉ có quyền này sẽ bị đưa về đúng trang vừa bị ẩn.
    href: "/automation/provider-list",
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
    // Đặt SAU /tasks: danh sách này quyết trang đích sau khi đăng nhập theo thứ
    // tự, và người có cả hai quyền nên hạ cánh ở Health CS như trước. Trước đây
    // không có mục nào cho lead, nên hai tài khoản chỉ-có-quyền-lead rơi thẳng
    // vào /unauthorized.
    href: "/tasks/leads",
    anyPermission: [PERMISSIONS.LEAD_MANAGE, PERMISSIONS.LEAD_WORK],
  },
  {
    href: "/config",
    permission: PERMISSIONS.TASK_MANAGE,
  },
  {
    href: "/time-off",
    anyPermission: [PERMISSIONS.TIME_OFF_USER, PERMISSIONS.TIME_OFF_ADMIN],
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

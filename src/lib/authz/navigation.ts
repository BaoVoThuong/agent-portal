import type { Action } from "./catalog";
import { hasGrant } from "./grants";

/**
 * REGISTRY ĐIỀU HƯỚNG — một chỗ trả lời "người này mở được trang nào", dùng
 * chung cho Sidebar, trang đích sau đăng nhập / khi bị từ chối
 * (`getFirstAccessiblePath`) và các nút trên TopBar.
 *
 * Trước Phase E có ba bản song song (Sidebar.tsx, rbac/routes.ts, từng page
 * guard), mỗi bản tự liệt kê permission phẳng, và từng trôi lệch nhau (menu
 * hiện mà trang từ chối, hoặc ngược lại). Đây chỉ là cổng HIỂN THỊ: mọi page và
 * API vẫn tự kiểm lại grant.
 *
 * Thứ tự quan trọng: `getFirstAccessiblePath` lấy mục ĐẦU TIÊN mở được.
 */
export type NavKey =
  | "registration.health"
  | "registration.pc"
  | "automation.health_statement"
  | "automation.pc_statement"
  | "provider.list"
  | "dashboard.health"
  | "dashboard.pc"
  | "tasks"
  | "enrollment"
  | "leads"
  | "config"
  | "timeoff"
  | "account_manager"
  | "role_manager"
  | "settings";

type NavRoute = {
  key: NavKey;
  href: string;
  /** Mở được khi có ÍT NHẤT MỘT action (bất kỳ scope). */
  anyOf: readonly Action[];
};

export const NAV_ROUTES: readonly NavRoute[] = [
  { key: "registration.health", href: "/", anyOf: ["registration.health.read"] },
  { key: "registration.pc", href: "/customer-registration/pc", anyOf: ["registration.pc.read"] },
  { key: "automation.health_statement", href: "/automation/health-statement", anyOf: ["automation.health_statement.run"] },
  { key: "automation.pc_statement", href: "/automation/pc-statement", anyOf: ["automation.pc_statement.run"] },
  // Provider Finder đã là tab trong Provider List — chỉ một đích cho nhóm này.
  { key: "provider.list", href: "/automation/provider-list", anyOf: ["provider.read"] },
  {
    key: "dashboard.health",
    href: "/dashboard/health",
    anyOf: ["dashboard.health.agent.read", "dashboard.health.company.read"],
  },
  {
    key: "dashboard.pc",
    href: "/dashboard/pc",
    anyOf: ["dashboard.pc.agent.read", "dashboard.pc.company.read"],
  },
  { key: "tasks", href: "/tasks", anyOf: ["task.read"] },
  { key: "enrollment", href: "/enrollment?program=aca", anyOf: ["enrollment.read"] },
  // Sau /tasks: người có cả hai hạ cánh ở Health CS như trước.
  { key: "leads", href: "/tasks/leads", anyOf: ["lead.read"] },
  // Chỉ những ai SỬA được ít nhất một bảng — trước đây mọi người giữ
  // task.manage đều thấy mục này rồi bị trang từ chối.
  {
    key: "config",
    href: "/config",
    anyOf: ["enrollment.options.manage", "task.config.manage", "lead.config.manage"],
  },
  { key: "timeoff", href: "/time-off", anyOf: ["timeoff.request", "timeoff.manage"] },
  { key: "account_manager", href: "/account-manager", anyOf: ["account.manage"] },
  { key: "role_manager", href: "/role-manager", anyOf: ["role.manage"] },
  { key: "settings", href: "/settings", anyOf: ["settings.access"] },
];

export function canOpenNav(grants: readonly string[], key: NavKey): boolean {
  const route = NAV_ROUTES.find((item) => item.key === key);
  return Boolean(route && route.anyOf.some((action) => hasGrant(grants, action)));
}

/** Các mục điều hướng mở được — server tính rồi gửi xuống Sidebar (không gửi grant). */
export function visibleNavKeys(grants: readonly string[]): NavKey[] {
  return NAV_ROUTES.filter((route) => route.anyOf.some((action) => hasGrant(grants, action))).map(
    (route) => route.key
  );
}

export function getFirstAccessiblePath(grants: readonly string[]): string {
  const route = NAV_ROUTES.find((item) => item.anyOf.some((action) => hasGrant(grants, action)));
  return route?.href ?? "/unauthorized";
}

/**
 * Chuông thông báo: có ít nhất một nguồn thông báo (task, enrollment, lead hoặc
 * time off). Trước đây chỉ hiện với quyền task, nên người chỉ dùng Time Off
 * không bao giờ thấy thông báo duyệt đơn của mình.
 */
export function canUseNotifications(grants: readonly string[]): boolean {
  return (
    hasGrant(grants, "task.read") ||
    hasGrant(grants, "enrollment.read") ||
    hasGrant(grants, "timeoff.request") ||
    hasGrant(grants, "timeoff.manage")
  );
}

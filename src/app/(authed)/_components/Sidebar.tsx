"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import styles from "./sidebar.module.css";
import { can, canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

type SidebarProps = {
  permissions?: string[];
};

type MenuItem = {
  href?: string;
  label?: string;
  title?: string;
  activePath?: string;
  activeQuery?: Record<string, string>;
  permission?: string;
  anyPermission?: string[];
  children?: MenuItem[];
};

const menuData: MenuItem[] = [
  {
    title: "Customer Registration",
    anyPermission: [
      PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH,
      PERMISSIONS.CUSTOMER_REGISTRATION_PC,
    ],
    children: [
      {
        href: "/",
        label: "Health",
        permission: PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH,
      },
      {
        href: "/customer-registration/pc",
        label: "P&C",
        permission: PERMISSIONS.CUSTOMER_REGISTRATION_PC,
      },
    ],
  },
  {
    title: "Automation Tool",
    anyPermission: [
      PERMISSIONS.AUTOMATION_HEALTH_STATEMENT,
      PERMISSIONS.AUTOMATION_PC_STATEMENT,
      PERMISSIONS.AUTOMATION_PROVIDER_FINDER,
    ],
    children: [
      {
        href: "/automation/health-statement",
        label: "Health Statement",
        permission: PERMISSIONS.AUTOMATION_HEALTH_STATEMENT,
      },
      {
        href: "/automation/pc-statement",
        label: "P&C Statement",
        permission: PERMISSIONS.AUTOMATION_PC_STATEMENT,
      },
      {
        href: "/automation/provider-finder",
        label: "Provider Finder",
        permission: PERMISSIONS.AUTOMATION_PROVIDER_FINDER,
      },
    ],
  },
  {
    title: "Dashboard",
    anyPermission: [
      PERMISSIONS.AGENT_DASHBOARD_HEALTH,
      PERMISSIONS.AGENT_DASHBOARD_PC,
      PERMISSIONS.COMPANY_DASHBOARD_HEALTH,
      PERMISSIONS.COMPANY_DASHBOARD_PC,
    ],
    children: [
      {
        href: "/dashboard/health",
        label: "Health",
        anyPermission: [
          PERMISSIONS.AGENT_DASHBOARD_HEALTH,
          PERMISSIONS.COMPANY_DASHBOARD_HEALTH,
        ],
      },
      {
        href: "/dashboard/pc",
        label: "P&C",
        anyPermission: [
          PERMISSIONS.AGENT_DASHBOARD_PC,
          PERMISSIONS.COMPANY_DASHBOARD_PC,
        ],
      },
    ],
  },
  {
    title: "Task Management",
    // Nới sang cả quyền lead: Event Leads nay nằm trong nhóm này, và hai tài
    // khoản trên production CHỈ có quyền lead. Giữ nguyên điều kiện cũ là hai
    // người đó mất luôn màn hình họ dùng hằng ngày — mất IM LẶNG, vì menu chỉ
    // đơn giản không hiện ra.
    anyPermission: [
      PERMISSIONS.TASK_MANAGE,
      PERMISSIONS.TASK_WORK,
      PERMISSIONS.LEAD_MANAGE,
      PERMISSIONS.LEAD_WORK,
    ],
    children: [
      {
        href: "/tasks",
        label: "Health Customer Service",
        anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK],
      },
      {
        href: "/enrollment?program=aca",
        label: "Health ACA Enrollment",
        activePath: "/enrollment",
        activeQuery: { program: "aca" },
        anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK],
      },
      {
        href: "/enrollment?program=medicare",
        label: "Health Medicare Enrollment",
        activePath: "/enrollment",
        activeQuery: { program: "medicare" },
        anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK],
      },
      {
        href: "/tasks/leads",
        label: "Event Leads",
        activePath: "/tasks/leads",
        anyPermission: [PERMISSIONS.LEAD_MANAGE, PERMISSIONS.LEAD_WORK],
      },
      {
        // MỘT mục cho cả bốn bảng. Người chỉ có quyền lead vào đây vẫn chỉ thấy
        // bảng Event Leads — xem configScopesFor ở lib/table-config.
        href: "/config",
        label: "Table Configuration",
        anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.LEAD_MANAGE],
      },
    ],
  },
  {
    href: "/time-off",
    label: "Time Off",
    anyPermission: [PERMISSIONS.TIME_OFF_USER, PERMISSIONS.TIME_OFF_ADMIN],
  },
  {
    title: "Account Management",
    anyPermission: [PERMISSIONS.ACCOUNT_MANAGER, PERMISSIONS.ROLE_MANAGER],
    children: [
      {
        href: "/account-manager",
        label: "Account Manager",
        permission: PERMISSIONS.ACCOUNT_MANAGER,
      },
      {
        href: "/role-manager",
        label: "Role Manager",
        permission: PERMISSIONS.ROLE_MANAGER,
      },
    ],
  },
];

function hasItemAccess(item: MenuItem, permissions: string[]) {
  if (item.permission) return can(permissions, item.permission);
  if (item.anyPermission) return canAny(permissions, item.anyPermission);
  return true;
}

export default function Sidebar({
  permissions = [],
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [openDropdowns, setOpenDropdowns] = useState<Record<string, boolean>>({
    "Customer Registration": true,
    "Automation Tool": pathname.startsWith("/automation"),
    Dashboard:
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/sales-dashboard"),
    "Task Management":
      pathname.startsWith("/tasks") ||
      pathname.startsWith("/enrollment") ||
      pathname.startsWith("/config"),
    Management:
      pathname.startsWith("/account-manager") ||
      pathname.startsWith("/role-manager") ||
      pathname.startsWith("/management"),
  });
  const menuItems = menuData
    .map((item) => {
      if (!item.children) return item;
      return {
        ...item,
        children: item.children.filter((child) => hasItemAccess(child, permissions)),
      };
    })
    .filter((item) => {
      if (item.children) return item.children.length > 0;
      return hasItemAccess(item, permissions);
    });

  const toggleDropdown = (title: string) => {
    setOpenDropdowns((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  // Every leaf, so a nested route can outrank its parent below.
  const leafItems = menuItems.flatMap((item) => item.children ?? [item]);

  const matchesPath = (item: MenuItem) => {
    if (!item.href) return false;
    const activePath = item.activePath ?? item.href.split("?")[0];
    return activePath === "/"
      ? pathname === "/"
      : pathname === activePath || pathname.startsWith(`${activePath}/`);
  };

  const isActiveItem = (item: MenuItem) => {
    if (!item.href) return false;
    const activePath = item.activePath ?? item.href.split("?")[0];
    if (!matchesPath(item)) return false;

    // An active entry renders as a <span>, not a <Link>. So a parent path that
    // also matches a deeper route would go unclickable while you are on that
    // deeper route: standing on /tasks/leads, "Health Customer Service" matches
    // /tasks/... too and would stop being a link, leaving no way back to the
    // task list. The most specific match wins.
    const deeperMatch = leafItems.some((other) => {
      if (other === item || !other.href) return false;
      const otherPath = other.activePath ?? other.href.split("?")[0];
      return otherPath.length > activePath.length && matchesPath(other);
    });
    if (deeperMatch) return false;

    if (!item.activeQuery) return true;
    return Object.entries(item.activeQuery).every(([key, value]) => {
      const current = searchParams.get(key);
      return current === value || (!current && key === "program" && value === "aca");
    });
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoWrap}>
        <Image
          className={styles.logo}
          src="/image/page_logo.png"
          alt="EPS"
          width={400}
          height={140}
          priority
        />
      </div>

      <nav className={styles.nav}>
        {menuItems.map((item, idx) => {
          if (item.children && item.title) {
            const isOpen = openDropdowns[item.title];
            return (
              <div key={item.title} className="mb-1 flex flex-col">
                <button
                  onClick={() => toggleDropdown(item.title ?? "")}
                  className={`${styles.navItem} flex w-full items-center justify-between text-left font-semibold`}
                  type="button"
                >
                  {item.title}
                  <svg
                    className={`h-4 w-4 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {isOpen && (
                  <div className="ml-4 mt-1 flex flex-col space-y-1 border-l border-white/10 pl-2">
                    {item.children.map((child) => {
                      const isActive = isActiveItem(child);
                      if (isActive) {
                        return (
                          <span
                            key={child.label}
                            className={`${styles.navItem} ${styles.active} py-2 text-sm`}
                            aria-current="page"
                          >
                            {child.label}
                          </span>
                        );
                      }
                      return (
                        <Link
                          key={child.label}
                          href={child.href ?? "#"}
                          prefetch
                          className={`${styles.navItem} py-2 text-sm`}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          const active = isActiveItem(item);
          if (active) {
            return (
              <span
                key={item.href ?? idx}
                className={`${styles.navItem} ${styles.active}`}
                aria-current="page"
              >
                {item.label}
              </span>
            );
          }
          return (
            <Link
              key={item.href ?? idx}
              href={item.href ?? "#"}
              prefetch
              className={styles.navItem}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  permission?: string;
  anyPermission?: string[];
  children?: MenuItem[];
};

const menuData: MenuItem[] = [
  {
    title: "Customer Registration",
    permission: PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH,
    children: [
      {
        href: "/",
        label: "Health",
        permission: PERMISSIONS.CUSTOMER_REGISTRATION_HEALTH,
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
    title: "Management",
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
  const [openDropdowns, setOpenDropdowns] = useState<Record<string, boolean>>({
    "Customer Registration": true,
    "Automation Tool": pathname.startsWith("/automation"),
    Dashboard:
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/sales-dashboard"),
    Management:
      pathname.startsWith("/account-manager") ||
      pathname.startsWith("/role-manager"),
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
                      const isActive = pathname === child.href;
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

          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
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

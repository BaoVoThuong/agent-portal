"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import styles from "./sidebar.module.css";
import type { NavKey } from "@/lib/authz/navigation";

type SidebarProps = {
  /** Các mục mở được — server tính từ grant (`visibleNavKeys`). */
  allowedNav: NavKey[];
};

type MenuItem = {
  href?: string;
  label?: string;
  title?: string;
  activePath?: string;
  activeQuery?: Record<string, string>;
  /** Mục lá: cổng hiển thị theo registry điều hướng. */
  nav?: NavKey;
  children?: MenuItem[];
};

const menuData: MenuItem[] = [
  {
    title: "Customer Registration",
    children: [
      {
        href: "/",
        label: "Health",
        nav: "registration.health",
      },
      {
        href: "/customer-registration/pc",
        label: "P&C",
        nav: "registration.pc",
      },
    ],
  },
  {
    title: "Automation Tool",
    children: [
      {
        href: "/automation/health-statement",
        label: "Health Statement",
        nav: "automation.health_statement",
      },
      {
        href: "/automation/pc-statement",
        label: "P&C Statement",
        nav: "automation.pc_statement",
      },
      {
        // Provider Finder không còn mục riêng: nó đã là tab "Finder Tool" bên
        // trong Provider List, dùng chung một bộ dữ liệu và một bộ lọc. Để hai
        // mục cạnh nhau chỉ khiến người dùng phải đoán xem nên bấm cái nào.
        href: "/automation/provider-list",
        label: "Provider List",
        nav: "provider.list",
      },
    ],
  },
  {
    title: "Dashboard",
    children: [
      {
        href: "/dashboard/health",
        label: "Health",
        nav: "dashboard.health",
      },
      {
        href: "/dashboard/pc",
        label: "P&C",
        nav: "dashboard.pc",
      },
    ],
  },
  {
    title: "Task Management",
    // Nhóm hiện khi có ít nhất một mục con mở được (kể cả người chỉ có quyền lead).
    children: [
      {
        href: "/tasks",
        label: "Health Customer Service",
        nav: "tasks",
      },
      {
        href: "/enrollment?program=aca",
        label: "Health ACA Enrollment",
        activePath: "/enrollment",
        activeQuery: { program: "aca" },
        nav: "enrollment",
      },
      {
        href: "/enrollment?program=medicare",
        label: "Health Medicare Enrollment",
        activePath: "/enrollment",
        activeQuery: { program: "medicare" },
        nav: "enrollment",
      },
      {
        href: "/enrollment?program=medicaid",
        label: "Health Medicaid Enrollment",
        activePath: "/enrollment",
        activeQuery: { program: "medicaid" },
        nav: "enrollment",
      },
      {
        href: "/tasks/leads",
        label: "Lead Management",
        activePath: "/tasks/leads",
        nav: "leads",
      },
      {
        // MỘT mục cho cả bốn bảng. Người chỉ có quyền lead vào đây vẫn chỉ thấy
        // bảng Lead Management — xem configScopesFor ở lib/table-config.
        href: "/config",
        label: "Table Configuration",
        nav: "config",
      },
    ],
  },
  {
    href: "/time-off",
    label: "Time Off",
    nav: "timeoff",
  },
  {
    title: "Account Management",
    children: [
      {
        href: "/account-manager",
        label: "Account Manager",
        nav: "account_manager",
      },
      {
        href: "/role-manager",
        label: "Role Manager",
        nav: "role_manager",
      },
    ],
  },
];

function hasItemAccess(item: MenuItem, allowed: ReadonlySet<NavKey>) {
  return item.nav ? allowed.has(item.nav) : true;
}

/** The one sidebar group that owns the current route, if there is one. */
function groupForPath(pathname: string): string | null {
  if (pathname === "/" || pathname.startsWith("/customer-registration")) {
    return "Customer Registration";
  }
  if (pathname.startsWith("/automation")) return "Automation Tool";
  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/sales-dashboard")
  ) {
    return "Dashboard";
  }
  if (
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/enrollment") ||
    pathname.startsWith("/config")
  ) {
    return "Task Management";
  }
  if (
    pathname.startsWith("/account-manager") ||
    pathname.startsWith("/role-manager") ||
    pathname.startsWith("/management")
  ) {
    return "Account Management";
  }
  return null;
}

export default function Sidebar({
  allowedNav,
}: SidebarProps) {
  const allowed = new Set(allowedNav);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dropdownState, setDropdownState] = useState(() => ({
    pathname,
    openDropdown: groupForPath(pathname),
  }));

  // Route đổi bằng Link/back/forward thì nhóm chứa route mới là nhóm DUY NHẤT
  // được mở. Có ý dùng payload server hiện tại để suy ra state ở đây, thay vì
  // setState trong effect (React lint chặn vì nó tạo thêm một render).
  const openDropdown =
    dropdownState.pathname === pathname
      ? dropdownState.openDropdown
      : groupForPath(pathname);
  const menuItems = menuData
    .map((item) => {
      if (!item.children) return item;
      return {
        ...item,
        children: item.children.filter((child) => hasItemAccess(child, allowed)),
      };
    })
    .filter((item) => {
      if (item.children) return item.children.length > 0;
      return hasItemAccess(item, allowed);
    });

  const toggleDropdown = (title: string) => {
    setDropdownState((current) => {
      const currentOpenDropdown =
        current.pathname === pathname
          ? current.openDropdown
          : groupForPath(pathname);
      return {
        pathname,
        openDropdown: currentOpenDropdown === title ? null : title,
      };
    });
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
            const isOpen = openDropdown === item.title;
            return (
              <div key={item.title} className="mb-1 flex flex-col">
                <button
                  onClick={() => toggleDropdown(item.title ?? "")}
                  className={`${styles.navItem} flex w-full items-center justify-between text-left font-semibold`}
                  type="button"
                  aria-expanded={isOpen}
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

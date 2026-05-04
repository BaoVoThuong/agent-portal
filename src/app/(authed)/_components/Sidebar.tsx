"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import styles from "./sidebar.module.css";
import type { UserRole } from "@/lib/config";

type SidebarProps = {
  userRole?: UserRole;
};

const menuData = [
  {
    title: "Customer Registration",
    children: [
      { href: "/", label: "Health" },
      { href: "#", label: "P&C", comingSoon: true },
      { href: "#", label: "Life", comingSoon: true },
    ]
  },
  { href: "/performance", label: "Agent Performance" },
];

export default function Sidebar({ userRole = "agent" }: SidebarProps) {
  const pathname = usePathname();
  const [openDropdowns, setOpenDropdowns] = useState<Record<string, boolean>>({
    "Customer Registration": true,
  });
  const menuItems =
    userRole === "admin"
      ? [...menuData, { href: "/account-manager", label: "Account Manager" }]
      : menuData;

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
          if (item.children) {
            const isOpen = openDropdowns[item.title];
            return (
              <div key={idx} className="flex flex-col mb-1">
                <button
                  onClick={() => toggleDropdown(item.title)}
                  className={`${styles.navItem} flex items-center justify-between font-semibold w-full text-left`}
                >
                  {item.title}
                  <svg
                    className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M19 9l-7 7-7-7"
                    ></path>
                  </svg>
                </button>
                {isOpen && (
                  <div className="flex flex-col ml-4 mt-1 space-y-1 border-l border-white/10 pl-2">
                    {item.children.map((child) => {
                      const isActive = pathname === child.href;
                      if (child.comingSoon) {
                        return (
                          <span
                            key={child.label}
                            className={`${styles.navItem} text-white/40 cursor-not-allowed flex items-center justify-between text-sm py-2`}
                          >
                            {child.label}
                            <span className="text-[10px] bg-white/10 text-white/60 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">
                              Soon
                            </span>
                          </span>
                        );
                      }
                      if (isActive) {
                        return (
                          <span
                            key={child.label}
                            className={`${styles.navItem} ${styles.active} text-sm py-2`}
                            aria-current="page"
                          >
                            {child.label}
                          </span>
                        );
                      }
                      return (
                        <Link
                          key={child.label}
                          href={child.href}
                          prefetch
                          className={`${styles.navItem} text-sm py-2`}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          } else {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            if (active) {
              return (
                <span
                  key={item.href}
                  className={`${styles.navItem} ${styles.active}`}
                  aria-current="page"
                >
                  {item.label}
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href!}
                prefetch
                className={styles.navItem}
              >
                {item.label}
              </Link>
            );
          }
        })}
      </nav>
    </aside>
  );
}

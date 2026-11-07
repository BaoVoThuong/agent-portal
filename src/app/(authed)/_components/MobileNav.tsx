"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type MobileNavValue = {
  open: boolean;
  openNav: () => void;
  closeNav: () => void;
};

const MobileNavContext = createContext<MobileNavValue>({
  open: false,
  openNav: () => {},
  closeNav: () => {},
});

/**
 * Whether the phone menu is open. The top bar opens it and the sidebar closes it.
 * Tied to the route it was opened on, and the back gesture closes it too: going
 * back between Enrollment programs keeps the path and only changes the query.
 * Above the phone breakpoint nothing reads this state.
 */
export function MobileNavProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const openNav = useCallback(() => setOpenedOn(pathname), [pathname]);
  const closeNav = useCallback(() => setOpenedOn(null), []);
  const open = openedOn === pathname;

  useEffect(() => {
    if (!open) return;
    window.addEventListener("popstate", closeNav);
    return () => window.removeEventListener("popstate", closeNav);
  }, [open, closeNav]);

  const value = useMemo(() => ({ open, openNav, closeNav }), [open, openNav, closeNav]);
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

export function useMobileNav() {
  return useContext(MobileNavContext);
}

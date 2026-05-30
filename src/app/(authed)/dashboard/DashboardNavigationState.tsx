"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

type DashboardNavigationState = {
  beginDashboardNavigation: () => void;
  isDashboardNavigating: boolean;
};

const DashboardNavigationContext =
  createContext<DashboardNavigationState | null>(null);

export function DashboardNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navigationKey = `${pathname}?${searchParams.toString()}`;
  const [pendingNavigationKey, setPendingNavigationKey] = useState<
    string | null
  >(null);
  const pendingNavigationKeyRef = useRef<string | null>(null);
  const isDashboardNavigating = pendingNavigationKey === navigationKey;
  const beginDashboardNavigation = useCallback(() => {
    pendingNavigationKeyRef.current = navigationKey;
    setPendingNavigationKey(navigationKey);
  }, [navigationKey]);
  const contextValue = useMemo(
    () => ({ beginDashboardNavigation, isDashboardNavigating }),
    [beginDashboardNavigation, isDashboardNavigating]
  );

  useEffect(() => {
    if (pendingNavigationKeyRef.current === null) return;

    const animationFrame = window.requestAnimationFrame(() => {
      pendingNavigationKeyRef.current = null;
      setPendingNavigationKey(null);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [navigationKey]);

  return (
    <DashboardNavigationContext.Provider value={contextValue}>
      {children}
    </DashboardNavigationContext.Provider>
  );
}

export function useDashboardNavigation() {
  return (
    useContext(DashboardNavigationContext)?.beginDashboardNavigation ??
    (() => {})
  );
}

export function DashboardNavigationContent({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const isDashboardNavigating =
    useContext(DashboardNavigationContext)?.isDashboardNavigating ?? false;

  return isDashboardNavigating ? <>{fallback}</> : <>{children}</>;
}

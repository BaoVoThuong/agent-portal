"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { AgentHealthPerformanceDashboardSkeleton } from "./AgentHealthPerformanceSkeleton";

type FilterState = {
  beginFiltering: () => void;
  isFiltering: boolean;
};

const FilterStateContext = createContext<FilterState | null>(null);

export function AgentHealthPerformanceFilterProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navigationKey = `${pathname}?${searchParams.toString()}`;
  const [filteringNavigationKey, setFilteringNavigationKey] = useState<
    string | null
  >(null);
  const isFiltering = filteringNavigationKey === navigationKey;
  const beginFiltering = useCallback(
    () => setFilteringNavigationKey(navigationKey),
    [navigationKey]
  );
  const contextValue = useMemo(
    () => ({ beginFiltering, isFiltering }),
    [beginFiltering, isFiltering]
  );

  return (
    <FilterStateContext.Provider value={contextValue}>
      {children}
    </FilterStateContext.Provider>
  );
}

export function useAgentHealthPerformanceFiltering() {
  return useContext(FilterStateContext)?.beginFiltering ?? (() => {});
}

export function AgentHealthPerformanceContent({ children }: { children: ReactNode }) {
  const isFiltering = useContext(FilterStateContext)?.isFiltering ?? false;

  return isFiltering ? <AgentHealthPerformanceDashboardSkeleton /> : children;
}

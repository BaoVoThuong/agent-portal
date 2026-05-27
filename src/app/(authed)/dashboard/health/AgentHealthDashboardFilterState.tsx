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
import { AgentHealthDashboardSkeleton } from "./AgentHealthDashboardSkeleton";

type FilterState = {
  beginFiltering: () => void;
  isFiltering: boolean;
};

const FilterStateContext = createContext<FilterState | null>(null);

export function AgentHealthDashboardFilterProvider({
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

export function useAgentHealthDashboardFiltering() {
  return useContext(FilterStateContext)?.beginFiltering ?? (() => {});
}

export function AgentHealthDashboardContent({ children }: { children: ReactNode }) {
  const isFiltering = useContext(FilterStateContext)?.isFiltering ?? false;

  return isFiltering ? <AgentHealthDashboardSkeleton /> : children;
}

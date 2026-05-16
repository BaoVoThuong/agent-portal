import { AgentHealthPerformanceDashboardSkeleton } from "./AgentHealthPerformanceSkeleton";

export default function AgentHealthPerformanceLoading() {
  return (
    <div className="px-8 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="h-8 w-72 animate-pulse rounded bg-[#e5eaf1]" />
          <div className="mt-3 h-4 w-80 animate-pulse rounded bg-[#e5eaf1]" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="h-9 w-44 animate-pulse rounded-lg bg-[#e5eaf1]" />
          <div className="h-9 w-56 animate-pulse rounded-lg bg-[#e5eaf1]" />
        </div>
      </header>

      <AgentHealthPerformanceDashboardSkeleton />
    </div>
  );
}

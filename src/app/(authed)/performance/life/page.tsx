import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";

export const dynamic = "force-dynamic";

export default async function LifePerformancePage() {
  await requirePermission(PERMISSIONS.AGENT_PERFORMANCE_LIFE_OWN);

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#16233a]">
          Life Performance
        </h1>
        <p className="mt-1 text-sm text-[#667085]">
          Life performance dashboard will be available here.
        </p>
      </header>

      <div className="rounded-lg border border-dashed border-[#d8dee7] bg-white px-8 py-16 text-center text-sm text-[#667085]">
        No Life performance view has been configured yet.
      </div>
    </div>
  );
}

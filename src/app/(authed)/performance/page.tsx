import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";

export default async function PerformancePage() {
  await requirePermission(PERMISSIONS.PERFORMANCE_OWN);

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#16233a]">
          Agent Performance
        </h1>
        <p className="mt-1 text-sm text-[#667085]">Coming soon.</p>
      </header>
      <div className="rounded-lg border border-dashed border-[#d8dee7] bg-white px-8 py-16 text-center text-sm text-[#667085]">
        Performance dashboard will live here.
      </div>
    </div>
  );
}

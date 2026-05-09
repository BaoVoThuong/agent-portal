import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import ProviderFinderClient from "./ProviderFinderClient";

export default async function ProviderFinderPage() {
  await requirePermission(PERMISSIONS.AUTOMATION_PROVIDER_FINDER);

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#16233a]">
          Provider Finder
        </h1>
        <p className="mt-1 text-sm text-[#667085]">
          Search nearby providers by address, insurance, specialty, and radius.
        </p>
      </header>
      <ProviderFinderClient />
    </div>
  );
}

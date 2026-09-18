import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { providerCarrierOptions } from "@/lib/providers/carriers";
import { providerLocationOptions } from "@/lib/providers/carriers";
import ProviderFinderClient from "./ProviderFinderClient";

export default async function ProviderFinderPage() {
  await requirePermission(PERMISSIONS.AUTOMATION_PROVIDER_FINDER);

  const { data } = await getSupabaseAdmin()
    .from("provider_directory")
    .select("obamacare,medicare,state,city")
    .is("archived_at", null)
    .limit(5000);
  const rows = (data ?? []) as Array<{
    obamacare: string | null;
    medicare: string | null;
    state: string | null;
    city: string | null;
  }>;
  const carrierOptions = providerCarrierOptions(rows);
  const stateOptions = providerLocationOptions(rows, "state");
  const cityOptions = providerLocationOptions(rows, "city");

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#16233a]">
          Provider Finder
        </h1>
        <p className="mt-1 text-sm text-[#667085]">
          Search nearby providers by address, insurance, and specialty.
        </p>
      </header>
      <ProviderFinderClient
        carrierOptions={carrierOptions}
        stateOptions={stateOptions}
        cityOptions={cityOptions}
      />
    </div>
  );
}

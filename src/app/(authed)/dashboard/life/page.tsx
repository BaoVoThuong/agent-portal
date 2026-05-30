import { can, canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireAnyPermission } from "@/lib/rbac/server";
import {
  DashboardViewSwitch,
  type DashboardView,
} from "../DashboardViewSwitch";
import {
  DashboardNavigationContent,
  DashboardNavigationProvider,
} from "../DashboardNavigationState";
import { DashboardViewSkeleton } from "../DashboardViewSkeleton";
import LifeSalesDashboardPage from "../../sales-dashboard/life/page";

export const dynamic = "force-dynamic";

type LifeDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const LIFE_AGENT_PERMISSIONS = [
  PERMISSIONS.AGENT_DASHBOARD_LIFE_OWN,
  PERMISSIONS.AGENT_DASHBOARD_LIFE_ALL,
];
const LIFE_DASHBOARD_PERMISSIONS = [
  ...LIFE_AGENT_PERMISSIONS,
  PERMISSIONS.SALES_DASHBOARD_ACCESS,
];

export default async function LifeDashboardPage({
  searchParams,
}: LifeDashboardPageProps) {
  const params = searchParams ? await searchParams : {};
  const session = await requireAnyPermission(LIFE_DASHBOARD_PERMISSIONS);
  const canViewAgent = canAny(session.user.permissions, LIFE_AGENT_PERMISSIONS);
  const canViewSales = can(
    session.user.permissions,
    PERMISSIONS.SALES_DASHBOARD_ACCESS
  );
  const activeView = resolveDashboardView(
    parseDashboardView(params.view),
    canViewAgent,
    canViewSales
  );

  if (activeView === "sales") {
    return <LifeSalesDashboardPage />;
  }

  return (
    <DashboardNavigationProvider>
      <div className="px-8 py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#16233a]">
              Life Agent Dashboard
            </h1>
            <p className="mt-1 text-sm text-[#667085]">
              Life agent dashboard will be available here.
            </p>
          </div>
          <DashboardViewSwitch
            activeView="agent"
            basePath="/dashboard/life"
            canViewAgent={canViewAgent}
            canViewSales={canViewSales}
            searchParams={params}
          />
        </header>

        <DashboardNavigationContent fallback={<DashboardViewSkeleton />}>
          <div className="rounded-lg border border-dashed border-[#d8dee7] bg-white px-8 py-16 text-center text-sm text-[#667085]">
            No Life dashboard view has been configured yet.
          </div>
        </DashboardNavigationContent>
      </div>
    </DashboardNavigationProvider>
  );
}

function parseDashboardView(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;

  return rawValue === "agent" || rawValue === "sales" ? rawValue : null;
}

function resolveDashboardView(
  requestedView: DashboardView | null,
  canViewAgent: boolean,
  canViewSales: boolean
): DashboardView {
  if (requestedView === "agent" && canViewAgent) return "agent";
  if (requestedView === "sales" && canViewSales) return "sales";
  if (canViewSales) return "sales";
  return "agent";
}

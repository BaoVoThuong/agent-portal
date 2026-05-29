import { canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { DashboardViewSwitch } from "../../dashboard/DashboardViewSwitch";

export const dynamic = "force-dynamic";

export default async function LifeSalesDashboardPage() {
  const session = await requirePermission(PERMISSIONS.SALES_DASHBOARD_ACCESS);
  const canViewAgent = canAny(session.user.permissions, [
    PERMISSIONS.AGENT_DASHBOARD_LIFE_OWN,
    PERMISSIONS.AGENT_DASHBOARD_LIFE_ALL,
  ]);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 md:px-10 text-slate-900">
      <div className="mx-auto max-w-[1536px]">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Life Sales Dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Life sales dashboard will be available here.
            </p>
          </div>
          <DashboardViewSwitch
            activeView="sales"
            basePath="/dashboard/life"
            canViewAgent={canViewAgent}
            canViewSales
            searchParams={{}}
          />
        </header>

        <div className="rounded-xl border border-slate-200 bg-white px-8 py-16 text-center text-sm font-medium text-slate-500 shadow-sm">
          No Life sales dashboard view has been configured yet.
        </div>
      </div>
    </div>
  );
}

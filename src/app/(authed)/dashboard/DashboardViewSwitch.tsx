import Link from "next/link";

export type DashboardView = "agent" | "sales";

type DashboardViewSwitchProps = {
  activeView: DashboardView;
  basePath: string;
  canViewAgent: boolean;
  canViewSales: boolean;
  searchParams: Record<string, string | string[] | undefined>;
};

export function DashboardViewSwitch({
  activeView,
  basePath,
  canViewAgent,
  canViewSales,
  searchParams,
}: DashboardViewSwitchProps) {
  const views: Array<{ value: DashboardView; label: string; visible: boolean }> = [
    { value: "agent", label: "Agent", visible: canViewAgent },
    { value: "sales", label: "Company", visible: canViewSales },
  ];
  const visibleViews = views.filter((view) => view.visible);

  if (visibleViews.length < 2) return null;

  return (
    <div className="inline-flex h-11 overflow-hidden rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
      {visibleViews.map((view) => {
        const isActive = activeView === view.value;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex min-w-[112px] items-center justify-center rounded-md px-4 text-sm font-semibold transition ${
              isActive
                ? "bg-[#1f5b96] text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
            href={buildViewHref(basePath, searchParams, view.value)}
            key={view.value}
          >
            {view.label}
          </Link>
        );
      })}
    </div>
  );
}

function buildViewHref(
  basePath: string,
  searchParams: Record<string, string | string[] | undefined>,
  view: DashboardView
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "view" || value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
      continue;
    }
    params.set(key, value);
  }

  params.set("view", view);

  return `${basePath}?${params.toString()}`;
}

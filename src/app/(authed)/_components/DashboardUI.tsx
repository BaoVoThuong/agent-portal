import { ReactNode } from "react";

export function DashboardPageWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 md:px-10 text-slate-900">
      <div className="mx-auto max-w-[1536px]">
        {children}
      </div>
    </div>
  );
}

export function DashboardHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-sm text-slate-500">
            {subtitle}
          </p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {children}
        </div>
      )}
    </header>
  );
}

export function KpiCard({
  label,
  value,
  trend,
  trendLabel,
  trendUpIsGood = true,
}: {
  label: string;
  value: string;
  trend?: number | null;
  trendLabel?: string;
  trendUpIsGood?: boolean;
}) {
  const hasTrend = trend !== undefined && trend !== null;
  const isUp = hasTrend && trend > 0;
  const isDown = hasTrend && trend < 0;
  
  let trendColorClass = "text-slate-500 bg-slate-50";
  if (isUp) {
    trendColorClass = trendUpIsGood ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50";
  } else if (isDown) {
    trendColorClass = trendUpIsGood ? "text-rose-600 bg-rose-50" : "text-emerald-600 bg-emerald-50";
  }

  return (
    <article className="flex flex-col justify-between min-h-[128px] rounded-xl border border-slate-200/60 bg-white p-5 shadow-sm transition-shadow duration-300 hover:shadow-md">
      <div className="text-sm font-medium text-slate-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold text-slate-900">
        {value}
      </div>
      <div className="mt-auto pt-4 flex items-center">
        {hasTrend ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${trendColorClass}`}>
            {isUp && <span className="mr-1">↑</span>}
            {isDown && <span className="mr-1">↓</span>}
            {Math.abs(trend)}%
          </span>
        ) : null}
        {trendLabel && (
          <span className={`text-xs font-medium ml-2 ${hasTrend ? "text-slate-500" : "text-slate-400"}`}>
            {trendLabel}
          </span>
        )}
      </div>
    </article>
  );
}

export function ReportPanel({
  title,
  children,
  titleClassName = "",
}: {
  title: string;
  children: ReactNode;
  titleClassName?: string;
}) {
  return (
    <section className="flex flex-col">
      <h3 className={`mb-4 text-lg font-bold leading-tight text-slate-800 ${titleClassName}`}>
        {title}
      </h3>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
        {children}
      </div>
    </section>
  );
}

// Table cell components for unified look
export function Th({
  children,
  align = "left",
  width,
  colSpan,
}: {
  children: ReactNode;
  align?: "left" | "center" | "right";
  width?: string | number;
  colSpan?: number;
}) {
  return (
    <th
      className={`bg-slate-50/80 backdrop-blur-sm border-b border-slate-200 px-4 py-3 align-middle text-xs font-semibold uppercase tracking-wider text-slate-500 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      }`}
      colSpan={colSpan}
      style={width ? { width } : undefined}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  strong = false,
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  strong?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`border-b border-slate-100 px-4 py-3 align-middle text-sm text-slate-700 transition-colors group-hover:bg-slate-50/50 ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-semibold text-slate-900" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

export function ProgressBarTd({
  value,
  maxValue = 100,
  label,
  colorClass = "bg-blue-400",
  bgClass = "bg-blue-50 border-blue-100",
  textClass = "text-blue-700",
}: {
  value: number;
  maxValue?: number;
  label: string;
  colorClass?: string;
  bgClass?: string;
  textClass?: string;
}) {
  const percent = maxValue === 0 ? 0 : Math.min(Math.abs(value / maxValue) * 100, 100);
  
  return (
    <td className="border-b border-slate-100 px-4 py-3 align-middle transition-colors group-hover:bg-slate-50/50">
      <div className="ml-auto flex w-full items-center justify-end">
        <div className={`relative h-6 w-full overflow-hidden rounded border ${bgClass}`}>
          <div
            className={`h-full rounded ${colorClass}`}
            style={{ width: `${percent}%` }}
          />
          <span className={`absolute inset-0 flex items-center justify-center text-xs font-semibold ${textClass}`}>
            {label}
          </span>
        </div>
      </div>
    </td>
  );
}

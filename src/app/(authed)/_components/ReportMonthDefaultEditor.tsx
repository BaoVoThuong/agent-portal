"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type ReportMonthDefaultType =
  | "all"
  | "current_year"
  | "fixed_range"
  | "latest_n_months";

export type ReportMonthDefaultConfig = {
  dashboardKey: string;
  defaultType: ReportMonthDefaultType;
  start: string | null;
  end: string | null;
  rollingMonths: number | null;
};

type DraftDefault = {
  defaultType: ReportMonthDefaultType;
  startMonth: string;
  endMonth: string;
  rollingMonths: number;
};

export function ReportMonthDefaultEditor({
  defaultConfig,
}: {
  defaultConfig: ReportMonthDefaultConfig;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<DraftDefault>(() =>
    configToDraft(defaultConfig)
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const summary = useMemo(
    () => formatDefaultSummary(defaultConfig),
    [defaultConfig]
  );

  async function saveDefault() {
    setMessage(null);

    if (
      draft.defaultType === "fixed_range" &&
      !draft.startMonth &&
      !draft.endMonth
    ) {
      setMessage("Select at least one month.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/dashboard-filter-defaults", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dashboardKey: defaultConfig.dashboardKey,
            defaultType: draft.defaultType,
            start: draft.startMonth || null,
            end: draft.endMonth || null,
            rollingMonths: draft.rollingMonths,
          }),
        });

        const result = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(result.error ?? "Unable to update default.");
        }

        const params = new URLSearchParams(searchParams.toString());
        params.delete("start");
        params.delete("end");
        params.delete("reportMonth");
        params.delete("reportMonthRange");

        const query = params.toString();
        const href = query ? `${pathname}?${query}` : pathname;
        const currentQuery = searchParams.toString();
        const currentHref = currentQuery
          ? `${pathname}?${currentQuery}`
          : pathname;

        setMessage("Default saved.");
        setIsOpen(false);

        if (href === currentHref) {
          router.refresh();
        } else {
          router.replace(href);
        }
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : "Unable to update default."
        );
      }
    });
  }

  return (
    <div className="relative mr-auto">
      <button
        type="button"
        onClick={() => {
          setMessage(null);
          if (!isOpen) setDraft(configToDraft(defaultConfig));
          setIsOpen((current) => !current);
        }}
        className="dashboard-filter-action text-[#184e8a] hover:bg-[#edf4ff]"
      >
        Default
      </button>

      {isOpen ? (
        <div className="dashboard-filter-menu absolute bottom-full left-0 z-40 mb-2.5 w-[min(21rem,calc(100vw-2rem))] p-3.5 text-left">
          <div className="mb-2.5">
            <div className="dashboard-filter-title text-[#16233a]">
              Report month default
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-[#667085]">
              Current: {summary}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-[#667085]">
              Default range
            </span>
            <select
              value={draft.defaultType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  defaultType: event.target.value as ReportMonthDefaultType,
                }))
              }
              className="h-8 w-full rounded-lg border border-[#cfd7e3] bg-white px-2 text-xs font-semibold text-[#16233a] outline-none focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/15"
            >
              <option value="latest_n_months">Latest N months</option>
              <option value="current_year">Current year</option>
              <option value="fixed_range">Fixed range</option>
              <option value="all">All report months</option>
            </select>
          </label>

          {draft.defaultType === "latest_n_months" ? (
            <label className="mt-2 block">
              <span className="mb-1 block text-[11px] font-semibold text-[#667085]">
                Months
              </span>
              <input
                min={1}
                max={120}
                type="number"
                value={draft.rollingMonths}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    rollingMonths: clampRollingMonths(event.target.value),
                  }))
                }
                className="h-8 w-full rounded-lg border border-[#cfd7e3] bg-white px-2 text-xs font-semibold text-[#16233a] outline-none focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/15"
              />
            </label>
          ) : null}

          {draft.defaultType === "fixed_range" ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-[#667085]">
                  Start
                </span>
                <input
                  type="month"
                  value={draft.startMonth}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      startMonth: event.target.value,
                    }))
                  }
                  className="h-8 w-full rounded-lg border border-[#cfd7e3] bg-white px-2 text-xs font-semibold text-[#16233a] outline-none focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/15"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-[#667085]">
                  End
                </span>
                <input
                  type="month"
                  value={draft.endMonth}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      endMonth: event.target.value,
                    }))
                  }
                  className="h-8 w-full rounded-lg border border-[#cfd7e3] bg-white px-2 text-xs font-semibold text-[#16233a] outline-none focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/15"
                />
              </label>
            </div>
          ) : null}

          {message ? (
            <div className="mt-2 text-[11px] font-semibold text-[#667085]">
              {message}
            </div>
          ) : null}

          <div className="dashboard-filter-footer mt-3">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="dashboard-filter-action"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveDefault}
              disabled={isPending}
              className="h-7 rounded-lg bg-[#184e8a] px-2.5 text-xs font-bold text-white transition hover:bg-[#123e71] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function configToDraft(config: ReportMonthDefaultConfig): DraftDefault {
  return {
    defaultType: config.defaultType,
    startMonth: dateToMonthValue(config.start),
    endMonth: dateToMonthValue(config.end),
    rollingMonths: config.rollingMonths ?? 12,
  };
}

function clampRollingMonths(value: string) {
  const numberValue = Number(value);

  if (!Number.isInteger(numberValue)) return 12;

  return Math.min(Math.max(numberValue, 1), 120);
}

function formatDefaultSummary(config: ReportMonthDefaultConfig) {
  if (config.defaultType === "all") return "All report months";
  if (config.defaultType === "current_year") return "Current year";
  if (config.defaultType === "latest_n_months") {
    return `Latest ${config.rollingMonths ?? 12} months`;
  }

  if (config.start && config.end) {
    return `${formatMonthLabel(config.start)} - ${formatMonthLabel(config.end)}`;
  }

  if (config.start) return `From ${formatMonthLabel(config.start)}`;
  if (config.end) return `Through ${formatMonthLabel(config.end)}`;

  return "Fixed range";
}

function dateToMonthValue(value: string | null) {
  return value?.slice(0, 7) ?? "";
}

function formatMonthLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateToMonthValue(value)}-01T00:00:00Z`));
}

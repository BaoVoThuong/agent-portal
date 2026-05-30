"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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

const DEFAULT_TYPE_OPTIONS: Array<{
  value: ReportMonthDefaultType;
  label: string;
  detail: string;
}> = [
  {
    value: "latest_n_months",
    label: "Latest N months",
    detail: "Rolling window",
  },
  {
    value: "current_year",
    label: "Current year",
    detail: "Jan to now",
  },
  {
    value: "fixed_range",
    label: "Fixed range",
    detail: "Pinned months",
  },
  {
    value: "all",
    label: "All months",
    detail: "No default filter",
  },
];

export function ReportMonthDefaultEditor({
  defaultConfig,
}: {
  defaultConfig: ReportMonthDefaultConfig;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [isOpen]);

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
    <div ref={containerRef} className="relative mr-auto">
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
        <div className="dashboard-filter-menu absolute left-0 top-full z-[70] mt-2.5 w-[min(24rem,calc(100vw-2rem))] p-4 text-left">
          <div className="mb-3">
            <div className="dashboard-filter-title text-[#16233a]">
              Report month default
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-[#667085]">
              Current: {summary}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {DEFAULT_TYPE_OPTIONS.map((option) => {
              const isSelected = draft.defaultType === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      defaultType: option.value,
                    }))
                  }
                  className={[
                    "rounded-xl border px-3 py-2 text-left transition",
                    isSelected
                      ? "border-[#184e8a] bg-[#edf4ff] shadow-[0_0_0_3px_rgba(24,78,138,0.12)]"
                      : "border-[#d8e0ec] bg-white hover:border-[#b7c6d9] hover:bg-[#f8fafc]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "block text-xs font-extrabold leading-4",
                      isSelected ? "text-[#184e8a]" : "text-[#16233a]",
                    ].join(" ")}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] font-semibold text-[#667085]">
                    {option.detail}
                  </span>
                </button>
              );
            })}
          </div>

          {draft.defaultType === "latest_n_months" ? (
            <label className="mt-3 block">
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
                className="h-10 w-full rounded-xl border border-[#cfd7e3] bg-white px-3 text-sm font-bold text-[#16233a] outline-none focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/15"
              />
            </label>
          ) : null}

          {draft.defaultType === "fixed_range" ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
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
                  className="h-10 w-full rounded-xl border border-[#cfd7e3] bg-white px-3 text-sm font-bold text-[#16233a] outline-none focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/15"
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
                  className="h-10 w-full rounded-xl border border-[#cfd7e3] bg-white px-3 text-sm font-bold text-[#16233a] outline-none focus:border-[#184e8a] focus:ring-2 focus:ring-[#184e8a]/15"
                />
              </label>
            </div>
          ) : null}

          {message ? (
            <div className="mt-3 rounded-lg bg-[#f8fafc] px-3 py-2 text-[11px] font-semibold text-[#667085]">
              {message}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-[#e5eaf1] pt-3">
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

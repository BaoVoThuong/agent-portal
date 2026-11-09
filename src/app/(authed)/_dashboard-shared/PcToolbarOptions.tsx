"use client";

export function PcToolbarOptions<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: { label: string; value: Value }[];
  value: Value;
}) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2" role="group" aria-label={label}>
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        {label}
      </span>
      <div className="inline-flex min-w-0 rounded-lg border border-slate-200 bg-white p-0.5 max-md:overflow-x-auto">
        {options.map((option) => {
          const isActive = option.value === value;

          return (
            <button
              aria-pressed={isActive}
              className={`h-7 shrink-0 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-[#184e8a] text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        {label}
      </span>
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {options.map((option) => {
          const isActive = option.value === value;

          return (
            <button
              aria-pressed={isActive}
              className={`h-7 rounded-md px-2.5 text-xs font-semibold transition ${
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

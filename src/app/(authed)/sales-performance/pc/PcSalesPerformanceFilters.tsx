"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

type FilterOptions = {
  agents: string[];
  agencies: string[];
};

type FilterValues = {
  policyNumber: string;
  agent: string;
  agency: string;
};

export function PcSalesPerformanceFilters({
  filters,
  options,
}: {
  filters: FilterValues;
  options: FilterOptions;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [policyNumber, setPolicyNumber] = useState(filters.policyNumber);

  function updateParam(name: keyof FilterValues, value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (value) {
      params.set(name, value);
    } else {
      params.delete(name);
    }

    const query = params.toString();

    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }

  function applyPolicyNumberFilter() {
    updateParam("policyNumber", policyNumber.trim());
  }

  return (
    <div className="mb-8 grid gap-8 lg:grid-cols-3">
      <label className="block">
        <span className="sr-only">Policy Number</span>
        <input
          aria-label="Policy Number"
          className="h-12 w-full rounded-sm border border-[#c8c8c8] bg-white px-7 text-sm font-semibold text-[#454545] shadow-[0_2px_4px_rgba(0,0,0,0.18)] outline-none transition focus:border-[#4b6f9f] focus:ring-2 focus:ring-[#4b6f9f]/20 disabled:opacity-60"
          disabled={isPending}
          onBlur={applyPolicyNumberFilter}
          onChange={(event) => setPolicyNumber(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyPolicyNumberFilter();
            }
          }}
          placeholder="Policy Number"
          type="search"
          value={policyNumber}
        />
      </label>
      <FilterSelect
        disabled={isPending}
        label="Agent"
        name="agent"
        onChange={(value) => updateParam("agent", value)}
        options={options.agents}
        value={filters.agent}
      />
      <FilterSelect
        disabled={isPending}
        label="Agency"
        name="agency"
        onChange={(value) => updateParam("agency", value)}
        options={options.agencies}
        value={filters.agency}
      />
    </div>
  );
}

function FilterSelect({
  disabled,
  label,
  name,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="h-12 w-full rounded-sm border-2 border-[#a0a0a0] bg-white px-7 text-sm font-semibold text-[#454545] shadow-[0_2px_4px_rgba(0,0,0,0.22)] outline-none transition focus:border-[#4b6f9f] focus:ring-2 focus:ring-[#4b6f9f]/20 disabled:opacity-60"
        disabled={disabled}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

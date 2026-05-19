"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

type FilterOptions = {
  agents: string[];
  carriers: string[];
  reportMonths: string[];
  messerStatements: string[];
};

type FilterValues = {
  agent: string;
  carrier: string;
  reportMonth: string;
  messerStatement: string;
  primaryMemberId: string;
};

export function HealthSalesPerformanceFilters({
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
  const [memberId, setMemberId] = useState(filters.primaryMemberId);

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

  function applyMemberIdFilter() {
    updateParam("primaryMemberId", memberId.trim());
  }

  return (
    <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.45fr_1.45fr]">
      <FilterSelect
        disabled={isPending}
        label="Agent Name"
        name="agent"
        options={options.agents}
        value={filters.agent}
        onChange={(value) => updateParam("agent", value)}
      />
      <FilterSelect
        disabled={isPending}
        label="Carrier"
        name="carrier"
        options={options.carriers}
        value={filters.carrier}
        onChange={(value) => updateParam("carrier", value)}
      />
      <FilterSelect
        disabled={isPending}
        label="Report Month"
        name="reportMonth"
        options={options.reportMonths}
        value={filters.reportMonth}
        onChange={(value) => updateParam("reportMonth", value)}
      />
      <FilterSelect
        disabled={isPending}
        label="Messer Statement"
        name="messerStatement"
        options={options.messerStatements}
        value={filters.messerStatement}
        onChange={(value) => updateParam("messerStatement", value)}
      />
      <label className="block">
        <span className="sr-only">Primary member id</span>
        <input
          aria-label="Primary member id"
          value={memberId}
          onBlur={applyMemberIdFilter}
          onChange={(event) => setMemberId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyMemberIdFilter();
            }
          }}
          placeholder="Primary_member_id"
          className="h-12 w-full rounded-sm border-2 border-[#a0a0a0] bg-white px-7 text-sm font-semibold text-[#454545] shadow-[0_2px_4px_rgba(0,0,0,0.22)] outline-none transition focus:border-[#4b6f9f] focus:ring-2 focus:ring-[#4b6f9f]/20 disabled:opacity-60"
          disabled={isPending}
          type="search"
        />
      </label>
    </div>
  );
}

function FilterSelect({
  disabled,
  label,
  name,
  options,
  value,
  onChange,
}: {
  disabled: boolean;
  label: string;
  name: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="h-12 w-full rounded-sm border border-[#c8c8c8] bg-white px-7 text-sm font-semibold text-[#454545] shadow-[0_2px_4px_rgba(0,0,0,0.18)] outline-none transition focus:border-[#4b6f9f] focus:ring-2 focus:ring-[#4b6f9f]/20 disabled:opacity-60"
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

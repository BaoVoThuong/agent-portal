"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { ProviderFinderMap } from "./ProviderFinderMap";

const carrierOptions = [
  "AMBETTER",
  "BCBS",
  "CHRISTUS",
  "CIGNA",
  "IMPERIAL",
  "MOLINA",
  "OSCAR",
  "UHC",
  "WELLPOINT",
];

const specialtyOptions = [
  "PCP - Adults",
  "PCP - Children",
  "PCP - Family",
  "OBGYN",
  "Cardiologist",
  "Dermatology",
  "Gastroenterology",
  "Nephrology",
  "Oncology",
  "Orthopedic",
  "Rheumatology",
  "Specialists",
];

type InsuranceType = "" | "obamacare" | "medicare" | "both";
type InsuranceColumn = { key: "obamacare" | "medicare"; label: string };

const insuranceOptions = [
  { value: "both", label: "Both" },
  { value: "obamacare", label: "Obamacare" },
  { value: "medicare", label: "Medicare" },
] satisfies Array<{ value: Exclude<InsuranceType, "">; label: string }>;

const insuranceTypeLabels: Record<Exclude<InsuranceType, "">, string> = {
  both: "Both",
  obamacare: "Obamacare",
  medicare: "Medicare",
};

type FormState = {
  street: string;
  city: string;
  state: string;
  zipcode: string;
  contract: string;
  specialty: string;
  insuranceType: InsuranceType;
};

type ProviderResult = {
  name: string;
  facility: string;
  specialty: string;
  npi: string;
  street: string;
  city: string;
  state: string;
  zipcode: string;
  phone: string;
  obamacare: string;
  medicare: string;
  otherPlans: string;
  distanceMeters: number | null;
  distanceKm: number | null;
  distanceMiles: number | null;
  lat: number | null;
  lng: number | null;
  address: string;
  polyline: string | null;
};

type SearchResponse = {
  origin?: {
    address: string;
    lat: number | null;
    lng: number | null;
  };
  results?: ProviderResult[];
  error?: string;
};

const initialForm: FormState = {
  street: "",
  city: "",
  state: "",
  zipcode: "",
  contract: "",
  specialty: "",
  insuranceType: "",
};

function formatDistance(value: number | null) {
  return value == null ? "-" : value.toFixed(2);
}

function hasAddress(form: FormState) {
  return [form.street, form.city, form.state, form.zipcode].some(
    (value) => value.trim() !== ""
  );
}

export default function ProviderFinderClient() {
  const insuranceMenuRef = useRef<HTMLDivElement | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<ProviderResult[]>([]);
  const [resultInsuranceType, setResultInsuranceType] =
    useState<InsuranceType>("");
  const [origin, setOrigin] = useState<SearchResponse["origin"]>(undefined);
  const [mapSelection, setMapSelection] = useState<"all" | number | null>(null);
  const [isInsuranceMenuOpen, setIsInsuranceMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun = useMemo(
    () => hasAddress(form) || form.contract.trim() !== "",
    [form]
  );
  const visibleInsuranceColumns = useMemo<InsuranceColumn[]>(() => {
    if (resultInsuranceType === "obamacare") {
      return [{ key: "obamacare", label: "Obamacare" }];
    }

    if (resultInsuranceType === "medicare") {
      return [{ key: "medicare", label: "Medicare" }];
    }

    return [
      { key: "obamacare", label: "Obamacare" },
      { key: "medicare", label: "Medicare" },
    ];
  }, [resultInsuranceType]);
  const tableColumnCount = 8 + visibleInsuranceColumns.length;
  const hasSingleInsuranceColumn = visibleInsuranceColumns.length === 1;

  const selectedProvider =
    typeof mapSelection === "number" ? results[mapSelection] ?? null : null;
  const mapTitle =
    mapSelection === "all"
      ? `All ${results.length} providers`
      : selectedProvider?.name || selectedProvider?.facility || "Selected provider";

  useEffect(() => {
    if (mapSelection === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMapSelection(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mapSelection]);

  useEffect(() => {
    if (!isInsuranceMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        insuranceMenuRef.current &&
        !insuranceMenuRef.current.contains(event.target as Node)
      ) {
        setIsInsuranceMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsInsuranceMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isInsuranceMenuOpen]);

  const updateField = <K extends keyof FormState>(
    key: K,
    value: FormState[K]
  ) => {
    setError(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRun) return;

    setIsRunning(true);
    setError(null);
    setResults([]);
    setResultInsuranceType(form.insuranceType);
    setOrigin(undefined);
    setMapSelection(null);

    try {
      const response = await fetch("/api/automation/provider-finder/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as SearchResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Provider search failed");
      }

      const nextResults = payload.results ?? [];
      setOrigin(payload.origin);
      setResults(nextResults);
      setResultInsuranceType(form.insuranceType);
      if (nextResults.length === 0) {
        setError(payload.error ?? "No provider found matching the criteria");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider search failed");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="relative z-20 rounded-lg border border-[#d8dee7] bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6ebf2] px-4 py-3">
          <h2 className="text-base font-semibold text-[#16233a]">
            Search Criteria
          </h2>
          <div className="flex items-center gap-3">
            <p className="text-sm text-[#667085]">
              {results.length
                ? `${results.length} provider(s)`
                : "Ready to search"}
            </p>
            <button
              type="submit"
              disabled={!canRun || isRunning}
              className="h-8 rounded-md bg-[#245a94] px-4 text-sm font-semibold text-white transition hover:bg-[#1f4c7d] disabled:cursor-not-allowed disabled:bg-[#b8c4d4]"
            >
              {isRunning ? "Running..." : "Run"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.7fr)_72px_105px_135px_minmax(170px,1fr)_145px] gap-3 overflow-visible px-4 py-3">
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-[#344054]">
              Street
            </span>
            <input
              value={form.street}
              onChange={(event) => updateField("street", event.target.value)}
              className="h-9 w-full rounded-md border border-[#cfd7e3] px-2.5 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
            />
          </label>

          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-[#344054]">
              City
            </span>
            <input
              value={form.city}
              onChange={(event) => updateField("city", event.target.value)}
              className="h-9 w-full rounded-md border border-[#cfd7e3] px-2.5 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
            />
          </label>

          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-[#344054]">
              State
            </span>
            <input
              value={form.state}
              onChange={(event) =>
                updateField("state", event.target.value.toUpperCase())
              }
              className="h-9 w-full rounded-md border border-[#cfd7e3] px-2.5 text-sm uppercase text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
              maxLength={2}
            />
          </label>

          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-[#344054]">
              Zipcode
            </span>
            <input
              value={form.zipcode}
              onChange={(event) => updateField("zipcode", event.target.value)}
              className="h-9 w-full rounded-md border border-[#cfd7e3] px-2.5 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
              inputMode="numeric"
            />
          </label>

          <SuggestionInput
            label="Carrier"
            value={form.contract}
            options={carrierOptions}
            uppercase
            onChange={(value) => updateField("contract", value)}
          />

          <SuggestionInput
            label="Specialty"
            value={form.specialty}
            options={specialtyOptions}
            onChange={(value) => updateField("specialty", value)}
          />

          <div ref={insuranceMenuRef} className="relative min-w-0">
            <span className="mb-1 block text-xs font-medium text-[#344054]">
              Insurance Type
            </span>
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isInsuranceMenuOpen}
              onClick={() => setIsInsuranceMenuOpen((current) => !current)}
              className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-[#cfd7e3] bg-white px-2.5 text-left text-sm text-[#16233a] outline-none transition hover:border-[#b8c4d4] focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
            >
              <span className="truncate">
                {form.insuranceType ? insuranceTypeLabels[form.insuranceType] : ""}
              </span>
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 border-b-2 border-r-2 border-[#667085] transition ${
                  isInsuranceMenuOpen ? "rotate-[225deg]" : "rotate-45"
                }`}
              />
            </button>
            {isInsuranceMenuOpen && (
              <div
                role="listbox"
                className="absolute left-0 top-[calc(100%+6px)] z-50 w-full min-w-[160px] overflow-hidden rounded-md border border-[#d8dee7] bg-white py-1 shadow-lg"
              >
                {insuranceOptions.map((option) => {
                  const isSelected = form.insuranceType === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        updateField("insuranceType", option.value);
                        setIsInsuranceMenuOpen(false);
                      }}
                      className={`flex h-9 w-full items-center justify-between px-3 text-left text-sm transition ${
                        isSelected
                          ? "bg-[#edf6ff] font-semibold text-[#245a94]"
                          : "text-[#16233a] hover:bg-[#f3f6fa]"
                      }`}
                    >
                      <span>{option.label}</span>
                      {isSelected && (
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-1.5 rotate-45 border-b-2 border-r-2 border-[#245a94]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </form>

      <section className="space-y-4">
        <div className="rounded-lg border border-[#d8dee7] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6ebf2] px-6 py-5">
            <h2 className="text-base font-semibold text-[#16233a]">
              Top 10 Providers
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={results.length === 0}
                onClick={() => setMapSelection("all")}
                className="h-9 rounded-md border border-[#cfd7e3] px-4 text-sm font-semibold text-[#245a94] transition hover:bg-[#f3f6fa] disabled:cursor-not-allowed disabled:text-[#98a2b3]"
              >
                Map all
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] table-fixed border-collapse border border-[#d8dee7] text-left text-[13px] leading-5 [&_td]:border [&_td]:border-[#e1e7ef] [&_th]:border [&_th]:border-[#d8dee7]">
              <colgroup>
                {hasSingleInsuranceColumn ? (
                  <>
                    <col className="w-[5%]" />
                    <col className="w-[7%]" />
                    <col className="w-[12%]" />
                    <col className="w-[9%]" />
                    <col className="w-[9%]" />
                    <col className="w-[15%]" />
                    <col className="w-[9%]" />
                    <col className="w-[10%]" />
                    <col className="w-[24%]" />
                  </>
                ) : (
                  <>
                    <col className="w-[5%]" />
                    <col className="w-[7%]" />
                    <col className="w-[11%]" />
                    <col className="w-[9%]" />
                    <col className="w-[9%]" />
                    <col className="w-[14%]" />
                    <col className="w-[9%]" />
                    <col className="w-[10%]" />
                    <col className="w-[16%]" />
                    <col className="w-[10%]" />
                  </>
                )}
              </colgroup>
              <thead className="bg-[#edf2f7] text-[11px] font-semibold uppercase tracking-wide text-[#344054]">
                <tr>
                  <th className="px-2 py-2.5">
                    <span className="sr-only">Map</span>
                  </th>
                  <th className="px-2 py-2.5 text-right">Distance</th>
                  <th className="px-3 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Specialty</th>
                  <th className="px-3 py-2.5">NPI</th>
                  <th className="px-3 py-2.5">Street</th>
                  <th className="px-3 py-2.5">City</th>
                  <th className="px-3 py-2.5">Phone</th>
                  {visibleInsuranceColumns.map((column) => (
                    <th key={column.key} className="px-3 py-2.5">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[#16233a]">
                {results.length === 0 ? (
                  <tr>
                    <td
                      colSpan={tableColumnCount}
                      className="px-4 py-10 text-center text-sm text-[#667085]"
                    >
                      Results will appear here after the provider search runs.
                    </td>
                  </tr>
                ) : (
                  results.map((provider, index) => (
                    <tr
                      key={`${provider.npi}-${index}`}
                      className={`transition hover:bg-[#f8fafc] ${
                        mapSelection === index ? "bg-[#edf6ff]" : ""
                      }`}
                    >
                      <td className="px-2 py-3 text-center align-top">
                        <button
                          type="button"
                          onClick={() => setMapSelection(index)}
                          className="h-7 rounded-md border border-[#cfd7e3] px-2 text-xs font-semibold text-[#245a94] transition hover:bg-[#f3f6fa]"
                        >
                          Map
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 text-right align-top font-semibold">
                        {formatDistance(provider.distanceMiles)}
                      </td>
                      <td className="break-words px-3 py-3 align-top font-semibold">
                        {provider.name}
                      </td>
                      <td className="break-words px-3 py-3 align-top">
                        {provider.specialty}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top">
                        {provider.npi}
                      </td>
                      <td className="break-words px-3 py-3 align-top">
                        {provider.street}
                      </td>
                      <td className="break-words px-3 py-3 align-top">
                        {provider.city}
                      </td>
                      <td className="break-words px-3 py-3 align-top">
                        {provider.phone}
                      </td>
                      {visibleInsuranceColumns.map((column) => (
                        <td
                          key={column.key}
                          className="break-words px-3 py-3 align-top"
                        >
                          {provider[column.key]}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {mapSelection !== null && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Provider map"
          >
            <button
              type="button"
              aria-label="Close provider map"
              onClick={() => setMapSelection(null)}
              className="absolute inset-0 bg-[#101828]/45"
            />
            <div className="relative z-10 flex max-h-[92vh] w-[min(1120px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6ebf2] px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-[#16233a]">
                    Map
                  </h2>
                  <p className="mt-0.5 text-sm font-medium text-[#667085]">
                    {mapTitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMapSelection(null)}
                  className="h-8 rounded-md border border-[#cfd7e3] px-3 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
                >
                  Close
                </button>
              </div>
              <div className="h-[min(72vh,680px)] min-h-[360px] overflow-hidden bg-[#eef3f7]">
                {origin ? (
                  <ProviderFinderMap
                    origin={origin}
                    results={results}
                    selection={mapSelection}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#667085]">
                    Run a provider search before opening the map.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-[#f2b8b5] bg-[#fff4f2] px-4 py-3 text-sm font-medium text-[#9f2f24]">
            {error}
          </div>
        )}

      </section>
    </div>
  );
}

function SuggestionInput({
  label,
  value,
  options,
  uppercase = false,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  uppercase?: boolean;
  onChange: (value: string) => void;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedValue = value.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedValue) return options;

    return options.filter((option) =>
      option.toLowerCase().includes(normalizedValue)
    );
  }, [normalizedValue, options]);
  const selectedValue = options.find(
    (option) => option.toLowerCase() === value.trim().toLowerCase()
  );
  const safeActiveIndex =
    filteredOptions.length === 0
      ? 0
      : Math.min(activeIndex, filteredOptions.length - 1);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function updateValue(nextValue: string) {
    setActiveIndex(0);
    onChange(uppercase ? nextValue.toUpperCase() : nextValue);
  }

  function selectOption(option: string) {
    updateValue(option);
    setIsOpen(false);
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <span className="mb-1 block text-xs font-medium text-[#344054]">
        {label}
      </span>
      <div className="relative">
        <input
          value={value}
          onChange={(event) => {
            updateValue(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) =>
                Math.min(current + 1, Math.max(filteredOptions.length - 1, 0))
              );
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            }

            if (
              event.key === "Enter" &&
              isOpen &&
              filteredOptions[safeActiveIndex]
            ) {
              event.preventDefault();
              selectOption(filteredOptions[safeActiveIndex]);
            }
          }}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className={`h-9 w-full rounded-md border border-[#cfd7e3] bg-white px-2.5 pr-8 text-sm text-[#16233a] outline-none transition hover:border-[#b8c4d4] focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15 ${
            uppercase ? "uppercase" : ""
          }`}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Show ${label} suggestions`}
          onClick={() => setIsOpen((current) => !current)}
          className="absolute right-0 top-0 flex h-9 w-8 items-center justify-center"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 border-b-2 border-r-2 border-[#667085] transition ${
              isOpen ? "rotate-[225deg]" : "rotate-45"
            }`}
          />
        </button>
      </div>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-64 w-full min-w-[190px] overflow-y-auto rounded-md border border-[#d8dee7] bg-white py-1 shadow-lg"
        >
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-[#667085]">
              No suggestions
            </div>
          ) : (
            filteredOptions.map((option, index) => {
              const isActive = index === safeActiveIndex;
              const isSelected = selectedValue === option;

              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                  className={`flex min-h-9 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                    isSelected
                      ? "bg-[#edf6ff] font-semibold text-[#245a94]"
                      : isActive
                        ? "bg-[#f3f6fa] text-[#16233a]"
                        : "text-[#16233a]"
                  }`}
                >
                  <span className="break-words">{option}</span>
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-1.5 shrink-0 rotate-45 border-b-2 border-r-2 border-[#245a94]"
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

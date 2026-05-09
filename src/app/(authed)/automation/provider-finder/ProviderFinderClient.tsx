"use client";

import { FormEvent, useMemo, useState } from "react";

const contractOptions = [
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

const radiusOptions = ["10", "20", "50", "100"];

type InsuranceType = "" | "obamacare" | "medicare" | "both";

type FormState = {
  street: string;
  city: string;
  state: string;
  zipcode: string;
  contract: string;
  specialty: string;
  radius: string;
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
  logs?: string[];
};

const initialForm: FormState = {
  street: "",
  city: "",
  state: "",
  zipcode: "",
  contract: "",
  specialty: "",
  radius: "",
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
  const [form, setForm] = useState<FormState>(initialForm);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<ProviderResult[]>([]);
  const [origin, setOrigin] = useState<SearchResponse["origin"]>(undefined);
  const [mapSelection, setMapSelection] = useState<"all" | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const canRun = useMemo(
    () => hasAddress(form) || form.contract.trim() !== "",
    [form]
  );

  const selectedProvider =
    typeof mapSelection === "number" ? results[mapSelection] ?? null : null;

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
    setOrigin(undefined);
    setMapSelection(null);
    setLogs([]);

    try {
      const response = await fetch("/api/automation/provider-finder/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as SearchResponse;
      setLogs(payload.logs ?? []);

      if (!response.ok) {
        throw new Error(payload.error ?? "Provider search failed");
      }

      const nextResults = payload.results ?? [];
      setOrigin(payload.origin);
      setResults(nextResults);
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
        className="rounded-lg border border-[#d8dee7] bg-white shadow-sm"
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

        <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.7fr)_72px_105px_112px_135px_minmax(170px,1fr)_145px] gap-3 overflow-x-auto px-4 py-3">
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-[#344054]">
              Street
            </span>
            <input
              value={form.street}
              onChange={(event) => updateField("street", event.target.value)}
              className="h-9 w-full rounded-md border border-[#cfd7e3] px-2.5 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
              placeholder="123 Main St"
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
              placeholder="Houston"
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
              placeholder="TX"
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
              placeholder="77072"
              inputMode="numeric"
            />
          </label>

          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-[#344054]">
              Radius
            </span>
            <select
              value={form.radius}
              onChange={(event) => updateField("radius", event.target.value)}
              className="h-9 w-full rounded-md border border-[#cfd7e3] bg-white px-2.5 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
            >
              <option value="">Any radius</option>
              {radiusOptions.map((radius) => (
                <option key={radius} value={radius}>
                  {radius} miles
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-[#344054]">
              Contract
            </span>
            <input
              value={form.contract}
              onChange={(event) =>
                updateField("contract", event.target.value.toUpperCase())
              }
              list="provider-contract-options"
              className="h-9 w-full rounded-md border border-[#cfd7e3] px-2.5 text-sm uppercase text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
              placeholder="AMBETTER"
            />
            <datalist id="provider-contract-options">
              {contractOptions.map((contract) => (
                <option key={contract} value={contract} />
              ))}
            </datalist>
          </label>

          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-[#344054]">
              Specialty
            </span>
            <input
              value={form.specialty}
              onChange={(event) => updateField("specialty", event.target.value)}
              list="provider-specialty-options"
              className="h-9 w-full rounded-md border border-[#cfd7e3] px-2.5 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
              placeholder="PCP - Adults"
            />
            <datalist id="provider-specialty-options">
              {specialtyOptions.map((specialty) => (
                <option key={specialty} value={specialty} />
              ))}
            </datalist>
          </label>

          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-[#344054]">
              Insurance Type
            </span>
            <select
              value={form.insuranceType}
              onChange={(event) =>
                updateField("insuranceType", event.target.value as InsuranceType)
              }
              className="h-9 w-full rounded-md border border-[#cfd7e3] bg-white px-2.5 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
            >
              <option value="">Any</option>
              <option value="obamacare">Obamacare</option>
              <option value="medicare">Medicare</option>
              <option value="both">Both</option>
            </select>
          </label>
        </div>
      </form>

      <section className="space-y-4">
        <div className="rounded-lg border border-[#d8dee7] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6ebf2] px-6 py-5">
            <h2 className="text-base font-semibold text-[#16233a]">
              Top 10 Providers
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-[#667085]">
                Radius: {form.radius ? `${form.radius} miles` : "Any"}
              </span>
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
            <table className="w-full min-w-[1260px] border-collapse text-left text-sm">
              <thead className="bg-[#edf2f7] text-xs font-semibold uppercase tracking-wide text-[#344054]">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Specialty</th>
                  <th className="px-4 py-3">NPI</th>
                  <th className="px-4 py-3">Street</th>
                  <th className="px-4 py-3">City</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">Zipcode</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Obamacare</th>
                  <th className="px-4 py-3">Medicare</th>
                  <th className="px-4 py-3">Other Plans</th>
                  <th className="px-4 py-3">Distance</th>
                  <th className="px-4 py-3">Map</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e6ebf2] text-[#16233a]">
                {results.length === 0 ? (
                  <tr>
                    <td
                      colSpan={13}
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
                      <td className="px-4 py-3 font-semibold">{provider.name}</td>
                      <td className="px-4 py-3">{provider.specialty}</td>
                      <td className="px-4 py-3">{provider.npi}</td>
                      <td className="px-4 py-3">{provider.street}</td>
                      <td className="px-4 py-3">{provider.city}</td>
                      <td className="px-4 py-3">{provider.state}</td>
                      <td className="px-4 py-3">{provider.zipcode}</td>
                      <td className="px-4 py-3">{provider.phone}</td>
                      <td className="px-4 py-3">{provider.obamacare}</td>
                      <td className="px-4 py-3">{provider.medicare}</td>
                      <td className="px-4 py-3">{provider.otherPlans}</td>
                      <td className="px-4 py-3 font-semibold">
                        {formatDistance(provider.distanceMiles)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setMapSelection(index)}
                          className="h-8 rounded-md border border-[#cfd7e3] px-3 text-xs font-semibold text-[#245a94] transition hover:bg-[#f3f6fa]"
                        >
                          Map
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {mapSelection !== null && (
          <div className="rounded-lg border border-[#d8dee7] bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6ebf2] px-6 py-5">
              <h2 className="text-base font-semibold text-[#16233a]">Map</h2>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-[#667085]">
                  {mapSelection === "all"
                    ? `All ${results.length} providers`
                    : selectedProvider?.name ?? "Selected provider"}
                </span>
                <button
                  type="button"
                  onClick={() => setMapSelection(null)}
                  className="h-8 rounded-md border border-[#cfd7e3] px-3 text-xs font-semibold text-[#344054] transition hover:bg-[#f3f6fa]"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="h-[420px] bg-[#eef3f7]">
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#667085]">
                {origin
                  ? "Map route preview will appear here after the Leaflet view is connected."
                  : "Run a provider search before opening the map."}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-[#f2b8b5] bg-[#fff4f2] px-4 py-3 text-sm font-medium text-[#9f2f24]">
            {error}
          </div>
        )}

        {logs.length > 0 && (
          <div className="rounded-lg border border-[#d8dee7] bg-white px-4 py-3 text-xs text-[#475467] shadow-sm">
            <div className="mb-2 font-semibold text-[#16233a]">Debug logs</div>
            <div className="space-y-1">
              {logs.map((entry, index) => (
                <div key={`${entry}-${index}`}>{entry}</div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

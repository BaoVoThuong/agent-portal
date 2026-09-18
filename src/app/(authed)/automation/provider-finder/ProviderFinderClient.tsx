"use client";

import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProviderFinderMap } from "./ProviderFinderMap";
import { useBodyScrollLock } from "../../_shared/useBodyScrollLock";
import { PROVIDER_SPECIALTY_OPTIONS } from "@/lib/providers/specialties";

const specialtyOptions = PROVIDER_SPECIALTY_OPTIONS.filter(
  (value) => value !== "Location Closed"
);

type InsuranceColumn = { key: "obamacare" | "medicare"; label: string };

type NearbyColumnKey =
  | "map"
  | "distance"
  | "name"
  | "specialty"
  | "npi"
  | "street"
  | "city"
  | "phone"
  | "obamacare"
  | "medicare";

const nearbyColumnKeys: NearbyColumnKey[] = [
  "map",
  "distance",
  "name",
  "specialty",
  "npi",
  "street",
  "city",
  "phone",
  "obamacare",
  "medicare",
];

const defaultNearbyColumnWidths: Record<NearbyColumnKey, number> = {
  map: 72,
  distance: 100,
  name: 180,
  specialty: 150,
  npi: 145,
  street: 230,
  city: 140,
  phone: 150,
  obamacare: 250,
  medicare: 220,
};

const minimumNearbyColumnWidths: Record<NearbyColumnKey, number> = {
  map: 64,
  distance: 82,
  name: 120,
  specialty: 110,
  npi: 120,
  street: 150,
  city: 110,
  phone: 120,
  obamacare: 160,
  medicare: 160,
};

const visibleInsuranceColumns: InsuranceColumn[] = [
  { key: "obamacare", label: "Obamacare" },
  { key: "medicare", label: "Medicare" },
];

type FormState = {
  street: string;
  city: string;
  state: string;
  zipcode: string;
  contract: string;
  specialty: string;
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
};

function formatDistance(value: number | null) {
  return value == null ? "-" : value.toFixed(2);
}

const planChipPalettes = [
  { background: "#d9f0f7", color: "#174b64" },
  { background: "#ffe1dc", color: "#7a2f2a" },
  { background: "#d9f1e5", color: "#1f5a43" },
  { background: "#e9e2f8", color: "#4b3b78" },
];

function splitPlans(value: string) {
  return value
    .split(",")
    .map((plan) => plan.trim())
    .filter(Boolean);
}

function hasAddress(form: FormState) {
  return [form.street, form.city, form.state, form.zipcode].some(
    (value) => value.trim() !== ""
  );
}

export default function ProviderFinderClient({
  carrierOptions = [],
  stateOptions = [],
  cityOptions = [],
}: {
  carrierOptions?: readonly string[];
  stateOptions?: readonly string[];
  cityOptions?: readonly string[];
}) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<ProviderResult[]>([]);
  const [origin, setOrigin] = useState<SearchResponse["origin"]>(undefined);
  const [mapSelection, setMapSelection] = useState<"all" | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState(defaultNearbyColumnWidths);
  const [isColumnResizing, setIsColumnResizing] = useState(false);

  const canRun = useMemo(
    () => hasAddress(form) || form.contract.trim() !== "",
    [form]
  );
  const tableColumnCount = 8 + visibleInsuranceColumns.length;
  const nearbyTableWidth = nearbyColumnKeys.reduce(
    (total, key) => total + columnWidths[key],
    0
  );

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
    if (!isColumnResizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isColumnResizing]);

  const updateField = <K extends keyof FormState>(
    key: K,
    value: FormState[K]
  ) => {
    setError(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const beginColumnResize = (
    key: NearbyColumnKey,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidths[key];
    setIsColumnResizing(true);

    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(
        minimumNearbyColumnWidths[key],
        startWidth + moveEvent.clientX - startX
      );
      setColumnWidths((current) => ({ ...current, [key]: nextWidth }));
    };

    const handleEnd = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleEnd);
      document.removeEventListener("pointercancel", handleEnd);
      setIsColumnResizing(false);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleEnd);
    document.addEventListener("pointercancel", handleEnd);
  };

  const renderResizeHandle = (key: NearbyColumnKey, label: string) => (
    <button
      type="button"
      aria-label={`Resize ${label} column`}
      onPointerDown={(event) => beginColumnResize(key, event)}
      className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0 transition hover:bg-[#0c66e4]/20 focus:bg-[#0c66e4]/20 focus:outline-none"
    />
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRun) return;

    setIsRunning(true);
    setError(null);
    setResults([]);
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
      if (nextResults.length === 0) {
        setError(payload.error ?? "No provider found matching the criteria");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider search failed");
    } finally {
      setIsRunning(false);
    }
  };


  useBodyScrollLock(mapSelection !== null);
  return (
    <div className="space-y-5">
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="relative z-20 min-w-0 overflow-visible rounded-lg border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-[#ebecf0] px-5 py-4">
          <h2 className="text-lg font-semibold text-[#172b4d]">Search Criteria</h2>
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-[#6b778c]">
              {results.length
                ? `${results.length} provider(s)`
                : "Ready to search"}
            </p>
            <button
              type="submit"
              disabled={!canRun || isRunning}
              className="h-9 rounded-lg bg-[#0c66e4] px-4 text-sm font-bold text-white transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:bg-[#b8c4d4]"
            >
              {isRunning ? "Running..." : "Run"}
            </button>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 overflow-visible px-5 py-4 sm:grid-cols-2 xl:grid-cols-6">
          <label className="min-w-0">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-[#6b778c]">
              Street
            </span>
            <input
              name="provider-finder-street"
              autoComplete="new-password"
              autoCorrect="off"
              spellCheck={false}
              value={form.street}
              onChange={(event) => updateField("street", event.target.value)}
              className="h-10 w-full rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#172b4d] outline-none transition hover:border-[#b8c4d4] focus:border-[#0c66e4] focus:ring-2 focus:ring-[#deebff]"
            />
          </label>

          <SuggestionInput
            label="City"
            value={form.city}
            options={cityOptions}
            onChange={(value) => updateField("city", value)}
          />

          <SuggestionInput
            label="State"
            value={form.state}
            options={stateOptions}
            uppercase
            onChange={(value) => updateField("state", value)}
          />

          <label className="min-w-0">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-[#6b778c]">
              Zipcode
            </span>
            <input
              name="provider-finder-zipcode"
              autoComplete="new-password"
              autoCorrect="off"
              spellCheck={false}
              value={form.zipcode}
              onChange={(event) => updateField("zipcode", event.target.value)}
              className="h-10 w-full rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#172b4d] outline-none transition hover:border-[#b8c4d4] focus:border-[#0c66e4] focus:ring-2 focus:ring-[#deebff]"
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

        </div>
      </form>

      <section className="space-y-4">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebecf0] px-5 py-4">
            <h2 className="text-lg font-semibold text-[#172b4d]">Top 10 Providers</h2>
            <button
              type="button"
              disabled={results.length === 0}
              onClick={() => setMapSelection("all")}
              className="h-9 rounded-lg border border-[#dfe1e6] bg-white px-4 text-sm font-bold text-[#0055cc] transition hover:bg-[#f7f8f9] disabled:cursor-not-allowed disabled:text-[#98a2b3]"
            >
              Map all
            </button>
          </div>

          <div className="overflow-x-auto">
            <table
              className="table-fixed border-collapse text-left text-[13px] leading-5 [&_td]:border-b [&_td]:border-[#ebecf0] [&_td+td]:border-l [&_td+td]:border-[#ebecf0] [&_th]:border-b [&_th]:border-[#dfe1e6] [&_th+th]:border-l [&_th+th]:border-[#dfe1e6]"
              style={{ width: `${nearbyTableWidth}px`, minWidth: "100%" }}
            >
              <colgroup>
                {nearbyColumnKeys.map((key) => (
                  <col key={key} style={{ width: `${columnWidths[key]}px` }} />
                ))}
              </colgroup>
              <thead className="bg-[#fafbfc] text-[11px] font-bold uppercase tracking-[0.06em] text-[#6b778c]">
                <tr>
                  <th className="relative px-2 py-3">
                    <span className="sr-only">Map</span>
                    {renderResizeHandle("map", "Map")}
                  </th>
                  <th className="relative px-2 py-3 text-right">
                    Distance
                    {renderResizeHandle("distance", "Distance")}
                  </th>
                  <th className="relative px-3 py-3">
                    Name
                    {renderResizeHandle("name", "Name")}
                  </th>
                  <th className="relative px-3 py-3">
                    Specialty
                    {renderResizeHandle("specialty", "Specialty")}
                  </th>
                  <th className="relative px-3 py-3">
                    NPI
                    {renderResizeHandle("npi", "NPI")}
                  </th>
                  <th className="relative px-3 py-3">
                    Street
                    {renderResizeHandle("street", "Street")}
                  </th>
                  <th className="relative px-3 py-3">
                    City
                    {renderResizeHandle("city", "City")}
                  </th>
                  <th className="relative px-3 py-3">
                    Phone
                    {renderResizeHandle("phone", "Phone")}
                  </th>
                  {visibleInsuranceColumns.map((column) => (
                    <th key={column.key} className="relative px-3 py-3">
                      {column.label}
                      {renderResizeHandle(column.key, column.label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[#16233a]">
                {results.length === 0 ? (
                  <tr>
                      <td
                        colSpan={tableColumnCount}
                      className="px-4 py-12 text-center text-sm font-semibold text-[#6b778c]"
                    >
                      Results will appear here after the provider search runs.
                    </td>
                  </tr>
                ) : (
                  results.map((provider, index) => (
                    <tr
                      key={`${provider.npi}-${index}`}
                      className={`transition hover:bg-[#f7f8f9] ${
                        mapSelection === index ? "bg-[#edf6ff]" : "bg-white"
                      }`}
                    >
                      <td className="px-2 py-2.5 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => setMapSelection(index)}
                          className="h-7 rounded-lg border border-[#b3d4ff] bg-[#deebff] px-2 text-xs font-bold text-[#0055cc] transition hover:bg-[#cce0ff]"
                        >
                          Map
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right align-middle font-semibold text-[#172b4d]">
                        {formatDistance(provider.distanceMiles)}
                      </td>
                      <td className="break-words px-3 py-2.5 align-middle font-semibold text-[#172b4d]">
                        {provider.name || "-"}
                      </td>
                      <td className="break-words px-3 py-2.5 align-middle font-medium text-[#42526e]">
                        {provider.specialty || "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-middle font-medium text-[#42526e]">
                        {provider.npi}
                      </td>
                      <td className="break-words px-3 py-2.5 align-middle font-medium text-[#42526e]">
                        {provider.street || "-"}
                      </td>
                      <td className="break-words px-3 py-2.5 align-middle font-medium text-[#42526e]">
                        {provider.city || "-"}
                      </td>
                      <td className="break-words px-3 py-2.5 align-middle font-medium text-[#42526e]">
                        {provider.phone || "-"}
                      </td>
                      {visibleInsuranceColumns.map((column) => (
                        <td
                          key={column.key}
                          className="px-3 py-2.5 align-middle"
                        >
                          <div className="flex min-w-0 flex-wrap gap-1">
                            {splitPlans(provider[column.key]).length === 0 ? (
                              <span className="text-sm font-medium text-[#97a0af]">—</span>
                            ) : (
                              splitPlans(provider[column.key]).map((plan, planIndex) => {
                                const palette = planChipPalettes[planIndex % planChipPalettes.length];
                                return (
                                  <span
                                    key={`${plan}-${planIndex}`}
                                    title={plan}
                                    className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.025em]"
                                    style={{
                                      backgroundColor: palette.background,
                                      color: palette.color,
                                    }}
                                  >
                                    {plan}
                                  </span>
                                );
                              })
                            )}
                          </div>
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
  options: readonly string[];
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
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-[#6b778c]">
        {label}
      </span>
      <div className="relative">
        <input
          name={`provider-finder-${label.toLowerCase().replace(/\s+/g, "-")}`}
          autoComplete="new-password"
          autoCorrect="off"
          spellCheck={false}
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
          className={`h-10 w-full rounded-lg border border-[#dfe1e6] bg-white px-3 pr-8 text-sm font-medium text-[#172b4d] outline-none transition hover:border-[#b8c4d4] focus:border-[#0c66e4] focus:ring-2 focus:ring-[#deebff] ${
            uppercase ? "uppercase" : ""
          }`}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Show ${label} suggestions`}
          onClick={() => setIsOpen((current) => !current)}
          className="absolute right-0 top-0 flex h-10 w-9 items-center justify-center"
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
          className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-64 w-full min-w-[190px] overflow-y-auto rounded-lg border border-[#dfe1e6] bg-white py-1 shadow-[0_8px_24px_rgba(9,30,66,0.16)]"
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

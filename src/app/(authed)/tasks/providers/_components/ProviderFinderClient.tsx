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
import { Check, ChevronDown, Map as MapIcon, Search, X } from "lucide-react";
import { ProviderFinderMap } from "./ProviderFinderMap";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";
import { MultiValueBadges } from "../../../_shared/MultiValueBadges";
import { PAGE_PRIMARY_BUTTON_CLASS } from "../../../_shared/page-header-styles";
import { PROVIDER_SPECIALTY_OPTIONS } from "@/lib/providers/specialties";
import { tableColumnOptionBadgePalette } from "@/lib/table-config/value-colors";
import type { TableColumnOption } from "@/lib/table-config/types";

const specialtyOptions = PROVIDER_SPECIALTY_OPTIONS.filter(
  (value) => value !== "Location Closed"
);

/** ACA / Medicare columns as the List tab shows them: its label and option colours. */
export type FinderPlanColumn = {
  key: "obamacare" | "medicare";
  label: string;
  options: TableColumnOption[];
};

/** Same field as the List tab's filters (2026-11-02). */
const FIELD_CLASS =
  "h-9 w-full rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#172b4d] outline-none transition placeholder:font-normal placeholder:text-[#6b778c] hover:border-[#c1c7d0] focus:border-[#0c66e4] focus:ring-2 focus:ring-[#cce0ff]";

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
  return value == null ? "—" : `${value.toFixed(2)} mi`;
}

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
  cityOptionsByState = {},
  planColumns = [],
}: {
  carrierOptions?: readonly string[];
  stateOptions?: readonly string[];
  cityOptions?: readonly string[];
  /** Lowercase state → its cities; picking a State narrows the City list. */
  cityOptionsByState?: Readonly<Record<string, readonly string[]>>;
  planColumns?: readonly FinderPlanColumn[];
}) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<ProviderResult[]>([]);
  const [origin, setOrigin] = useState<SearchResponse["origin"]>(undefined);
  const [mapSelection, setMapSelection] = useState<"all" | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState(defaultNearbyColumnWidths);
  const [isColumnResizing, setIsColumnResizing] = useState(false);

  const stateKey = form.state.trim().toLowerCase();
  const visibleCityOptions = stateKey ? cityOptionsByState[stateKey] ?? [] : cityOptions;

  const canRun = useMemo(
    () => hasAddress(form) || form.contract.trim() !== "",
    [form]
  );
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
    <div className="flex min-w-0 flex-col gap-3">
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="relative z-20 flex min-w-0 flex-wrap items-center gap-2"
      >
        <input
          name="provider-finder-street"
          aria-label="Street"
          autoComplete="new-password"
          autoCorrect="off"
          spellCheck={false}
          value={form.street}
          onChange={(event) => updateField("street", event.target.value)}
          placeholder="Street address"
          className={`${FIELD_CLASS} !w-auto min-w-[12rem] flex-[2]`}
        />
        <SuggestionInput
          label="State"
          value={form.state}
          options={stateOptions}
          uppercase
          className="w-[6.5rem]"
          onChange={(value) => {
            // A city from another state would only make the search miss.
            const cities = cityOptionsByState[value.trim().toLowerCase()];
            const keepCity = !value.trim() || !form.city.trim() ||
              Boolean(cities?.some((city) => city.toLowerCase() === form.city.trim().toLowerCase()));
            setError(null);
            setForm((current) => ({ ...current, state: value, city: keepCity ? current.city : "" }));
          }}
        />
        <SuggestionInput
          label="City"
          value={form.city}
          options={visibleCityOptions}
          className="w-[10rem]"
          onChange={(value) => updateField("city", value)}
        />
        <input
          name="provider-finder-zipcode"
          aria-label="ZIP code"
          autoComplete="new-password"
          autoCorrect="off"
          spellCheck={false}
          value={form.zipcode}
          onChange={(event) => updateField("zipcode", event.target.value)}
          placeholder="ZIP code"
          className={`${FIELD_CLASS} !w-[7rem]`}
          inputMode="numeric"
        />
        <SuggestionInput
          label="Carrier"
          value={form.contract}
          options={carrierOptions}
          uppercase
          className="w-[9.5rem]"
          onChange={(value) => updateField("contract", value)}
        />
        <SuggestionInput
          label="Specialty"
          value={form.specialty}
          options={specialtyOptions}
          className="w-[11rem]"
          onChange={(value) => updateField("specialty", value)}
        />
        <button type="submit" disabled={!canRun || isRunning} className={PAGE_PRIMARY_BUTTON_CLASS}>
          <Search className="h-4 w-4" />
          {isRunning ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-[#ffd5d2] bg-[#ffeceb] px-4 py-3 text-sm font-medium text-[#ae2e24]">
          {error}
        </div>
      )}

      {results.length === 0 ? (
        <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
          {isRunning ? "Searching…" : "Enter an address or a carrier, then Search."}
        </div>
      ) : (
        <div className="min-w-0 overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
          <div className="overflow-x-auto">
            <table
              className="table-fixed border-collapse text-left text-sm leading-5"
              style={{ width: `${nearbyTableWidth}px`, minWidth: "100%" }}
            >
              <colgroup>
                {nearbyColumnKeys.map((key) => (
                  <col key={key} style={{ width: `${columnWidths[key]}px` }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 border-b border-[#dfe1e6] bg-[#fafbfc] text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
                <tr>
                  <th className="relative px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => setMapSelection("all")}
                      title={`Show all ${results.length} on the map`}
                      className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-[#0c66e4] bg-white px-2 text-xs font-semibold normal-case tracking-normal text-[#0c66e4] transition hover:bg-[#e9f2ff]"
                    >
                      <MapIcon className="h-3.5 w-3.5" />
                      All
                    </button>
                    {renderResizeHandle("map", "Map")}
                  </th>
                  <th className="relative px-3 py-2 text-right">
                    Distance
                    {renderResizeHandle("distance", "Distance")}
                  </th>
                  <th className="relative px-3 py-2">
                    Name
                    {renderResizeHandle("name", "Name")}
                  </th>
                  <th className="relative px-3 py-2">
                    Specialty
                    {renderResizeHandle("specialty", "Specialty")}
                  </th>
                  <th className="relative px-3 py-2">
                    NPI
                    {renderResizeHandle("npi", "NPI")}
                  </th>
                  <th className="relative px-3 py-2">
                    Street
                    {renderResizeHandle("street", "Street")}
                  </th>
                  <th className="relative px-3 py-2">
                    City
                    {renderResizeHandle("city", "City")}
                  </th>
                  <th className="relative px-3 py-2">
                    Phone
                    {renderResizeHandle("phone", "Phone")}
                  </th>
                  {planColumns.map((column) => (
                    <th key={column.key} className="relative px-3 py-2">
                      {column.label}
                      {renderResizeHandle(column.key, column.label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-medium text-[#42526e]">
                {results.map((provider, index) => (
                  <tr
                    key={`${provider.npi}-${index}`}
                    className={`border-b border-[#ebecf0] transition last:border-b-0 ${
                      mapSelection === index ? "bg-[#e9f2ff]" : "hover:bg-[#f7f8f9]"
                    }`}
                  >
                    <td className="px-3 py-2.5 align-middle">
                      <button
                        type="button"
                        onClick={() => setMapSelection(index)}
                        className="inline-flex h-7 items-center rounded-md border border-[#dfe1e6] bg-white px-2 text-xs font-semibold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
                      >
                        Map
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-semibold tabular-nums text-[#172b4d]">
                      {formatDistance(provider.distanceMiles)}
                    </td>
                    <td className="break-words px-3 py-2.5 align-middle font-semibold text-[#172b4d]">
                      {provider.name || "—"}
                    </td>
                    <td className="break-words px-3 py-2.5 align-middle">{provider.specialty || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-middle tabular-nums">{provider.npi}</td>
                    <td className="break-words px-3 py-2.5 align-middle">{provider.street || "—"}</td>
                    <td className="break-words px-3 py-2.5 align-middle">{provider.city || "—"}</td>
                    <td className="break-words px-3 py-2.5 align-middle tabular-nums">{provider.phone || "—"}</td>
                    {planColumns.map((column) => {
                      const plans = splitPlans(provider[column.key]);
                      return (
                        <td key={column.key} className="px-3 py-2.5 align-middle">
                          {plans.length === 0 ? (
                            <span className="text-[#97a0af]">—</span>
                          ) : (
                            <MultiValueBadges
                              items={plans.map((plan, planIndex) => {
                                const option = column.options.find(
                                  (candidate) => candidate.label.toLowerCase() === plan.toLowerCase()
                                );
                                const palette = option ? tableColumnOptionBadgePalette(option) : null;
                                return {
                                  key: `${plan}-${planIndex}`,
                                  label: option?.label ?? plan,
                                  style: palette
                                    ? { backgroundColor: palette.background, color: palette.foreground }
                                    : undefined,
                                };
                              })}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
            className="absolute inset-0 bg-[#091e42]/40"
          />
          <div className="relative z-10 flex max-h-[92vh] w-[min(1120px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[#dfe1e6] px-5 py-4">
              <h2 className="min-w-0 truncate text-lg font-bold text-[#172b4d]">{mapTitle}</h2>
              <button
                type="button"
                onClick={() => setMapSelection(null)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-[#6b778c] transition hover:bg-[#f1f2f4] hover:text-[#172b4d]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="h-[min(72vh,680px)] min-h-[360px] overflow-hidden bg-[#f4f5f7]">
              {origin ? (
                <ProviderFinderMap origin={origin} results={results} selection={mapSelection} />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#6b778c]">
                  Run a provider search before opening the map.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionInput({
  label,
  value,
  options,
  uppercase = false,
  className = "",
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  uppercase?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Keep the selected value visible in the field without using it as the
  // dropdown search query. After selecting "FL", opening the menu again must
  // still show the other states so the user can correct the choice.
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;

    return options.filter((option) =>
      option.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery, options]);
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
    setQuery(nextValue);
    onChange(uppercase ? nextValue.toUpperCase() : nextValue);
  }

  function selectOption(option: string) {
    setActiveIndex(0);
    setQuery("");
    onChange(uppercase ? option.toUpperCase() : option);
    setIsOpen(false);
  }

  return (
    <div ref={rootRef} className={`relative min-w-0 shrink-0 ${className}`}>
      <div className="relative">
        <input
          name={`provider-finder-${label.toLowerCase().replace(/\s+/g, "-")}`}
          autoComplete="new-password"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder={label}
          aria-label={label}
          onChange={(event) => {
            updateValue(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setIsOpen(true);
          }}
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
          className={`${FIELD_CLASS} pr-8 ${uppercase ? "uppercase placeholder:normal-case" : ""}`}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Show ${label} suggestions`}
          onClick={() => {
            setQuery("");
            setIsOpen((current) => !current);
          }}
          className="absolute right-0 top-0 flex h-9 w-8 items-center justify-center"
        >
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 text-[#667085] transition ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 top-[calc(100%+4px)] z-50 max-h-64 w-full min-w-[200px] overflow-y-auto rounded-lg border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.16)]"
        >
          {filteredOptions.length === 0 ? (
            <div className="px-2.5 py-2 text-sm text-[#6b778c]">
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
                  className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium transition ${
                    isSelected
                      ? "bg-[#e9f2ff] text-[#0c66e4]"
                      : isActive
                        ? "bg-[#f1f2f4] text-[#172b4d]"
                        : "text-[#172b4d]"
                  }`}
                >
                  <span className="break-words">{option}</span>
                  {isSelected && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

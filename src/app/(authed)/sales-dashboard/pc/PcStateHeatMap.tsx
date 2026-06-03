"use client";

import { useMemo, useRef, useState, type MouseEvent } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import statesTopo from "us-atlas/states-10m.json";

const WIDTH = 960;
const HEIGHT = 560;
const MAP_PADDING = 42;
const TEXAS_STATE = "TX";
const CITY_ROW_LIMIT = 5;
const TOP_CITY_MARKER_COLORS = [
  "#1d4e8a",
  "#2f80ed",
  "#0f766e",
  "#7c3aed",
  "#f59e0b",
];
const CITY_MARKER_OFFSETS: Record<string, { dx: number; dy: number }> = {
  CYPRESS: { dx: 38, dy: -84 },
  HOUSTON: { dx: 58, dy: -24 },
  KATY: { dx: -80, dy: -44 },
  RICHMOND: { dx: 64, dy: 52 },
  SAN_ANTONIO: { dx: -10, dy: 18 },
  SPRING: { dx: 82, dy: -78 },
  SUGAR_LAND: { dx: -44, dy: 54 },
  TOMBALL: { dx: -66, dy: -88 },
};

const STATE_NAME_TO_ABBR: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  "District of Columbia": "DC",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "Puerto Rico": "PR",
};

type StateShape = { name: string; abbr: string; d: string };
type PcStateMapCityRow = {
  state: string;
  city: string;
  isTotal: boolean;
  policyCount: number;
  policySharePercent: number;
  totalPremium: number;
  totalCommission: number;
};

type PcStateMapGroup = {
  state: string;
  rows: PcStateMapCityRow[];
};

type CityPoint = PcStateMapCityRow & {
  latitude: number;
  longitude: number;
  x: number;
  y: number;
};

type MapTooltip = {
  title: string;
  lines: string[];
  x: number;
  y: number;
};

type ProjectionMap = {
  project: (longitude: number, latitude: number) => [number, number] | null;
  shapes: StateShape[];
};

const TEXAS_CITY_COORDS: Record<
  string,
  { latitude: number; longitude: number }
> = {
  ABILENE: { latitude: 32.4487, longitude: -99.7331 },
  ALLEN: { latitude: 33.1032, longitude: -96.6706 },
  ALVIN: { latitude: 29.4238, longitude: -95.2441 },
  AMARILLO: { latitude: 35.222, longitude: -101.8313 },
  ARLINGTON: { latitude: 32.7357, longitude: -97.1081 },
  AUSTIN: { latitude: 30.2672, longitude: -97.7431 },
  BAYTOWN: { latitude: 29.7355, longitude: -94.9774 },
  BEAUMONT: { latitude: 30.0802, longitude: -94.1266 },
  BROWNSVILLE: { latitude: 25.9017, longitude: -97.4975 },
  BRYAN: { latitude: 30.6744, longitude: -96.37 },
  CARROLLTON: { latitude: 32.9756, longitude: -96.8899 },
  COLLEGE_STATION: { latitude: 30.628, longitude: -96.3344 },
  CONROE: { latitude: 30.3119, longitude: -95.4561 },
  CORPUS_CHRISTI: { latitude: 27.8006, longitude: -97.3964 },
  CYPRESS: { latitude: 29.9691, longitude: -95.6972 },
  DALLAS: { latitude: 32.7767, longitude: -96.797 },
  DEER_PARK: { latitude: 29.7052, longitude: -95.1238 },
  DENTON: { latitude: 33.2148, longitude: -97.1331 },
  EL_PASO: { latitude: 31.7619, longitude: -106.485 },
  FORT_WORTH: { latitude: 32.7555, longitude: -97.3308 },
  FRISCO: { latitude: 33.1507, longitude: -96.8236 },
  FRIENDSWOOD: { latitude: 29.5294, longitude: -95.201 },
  FULSHEAR: { latitude: 29.6938, longitude: -95.8997 },
  GALVESTON: { latitude: 29.3013, longitude: -94.7977 },
  GARLAND: { latitude: 32.9126, longitude: -96.6389 },
  GEORGETOWN: { latitude: 30.6333, longitude: -97.6772 },
  GRAPEVINE: { latitude: 32.9343, longitude: -97.0781 },
  HOUSTON: { latitude: 29.7604, longitude: -95.3698 },
  HUMBLE: { latitude: 29.9988, longitude: -95.2622 },
  IRVING: { latitude: 32.814, longitude: -96.9489 },
  KATY: { latitude: 29.7858, longitude: -95.8244 },
  LA_PORTE: { latitude: 29.6658, longitude: -95.0194 },
  LAREDO: { latitude: 27.5036, longitude: -99.5076 },
  LEAGUE_CITY: { latitude: 29.5075, longitude: -95.0949 },
  LEWISVILLE: { latitude: 33.0462, longitude: -96.9942 },
  LUBBOCK: { latitude: 33.5779, longitude: -101.8552 },
  MAGNOLIA: { latitude: 30.2094, longitude: -95.7508 },
  MCALLEN: { latitude: 26.2034, longitude: -98.23 },
  MCKINNEY: { latitude: 33.1972, longitude: -96.6398 },
  MESQUITE: { latitude: 32.7668, longitude: -96.5992 },
  MIDLAND: { latitude: 31.9973, longitude: -102.0779 },
  MISSOURI_CITY: { latitude: 29.6186, longitude: -95.5377 },
  NEW_BRAUNFELS: { latitude: 29.703, longitude: -98.1245 },
  ODESSA: { latitude: 31.8457, longitude: -102.3676 },
  PASADENA: { latitude: 29.6911, longitude: -95.2091 },
  PEARLAND: { latitude: 29.5636, longitude: -95.286 },
  PLANO: { latitude: 33.0198, longitude: -96.6989 },
  RICHARDSON: { latitude: 32.9483, longitude: -96.7299 },
  RICHMOND: { latitude: 29.5822, longitude: -95.7608 },
  ROSENBERG: { latitude: 29.5572, longitude: -95.8086 },
  ROUND_ROCK: { latitude: 30.5083, longitude: -97.6789 },
  SAN_ANTONIO: { latitude: 29.4241, longitude: -98.4936 },
  SPRING: { latitude: 30.0799, longitude: -95.4172 },
  STAFFORD: { latitude: 29.6161, longitude: -95.5577 },
  SUGAR_LAND: { latitude: 29.6197, longitude: -95.6349 },
  THE_WOODLANDS: { latitude: 30.1658, longitude: -95.4613 },
  TOMBALL: { latitude: 30.0972, longitude: -95.6161 },
  WACO: { latitude: 31.5493, longitude: -97.1467 },
};

// Build the state path strings once, at module load.
const STATE_SHAPES: StateShape[] = (() => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const topo = statesTopo as any;
  const collection = feature(topo, topo.objects.states) as any;
  const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], collection);
  const path = geoPath(projection);

  return (collection.features as any[]).map((shape) => ({
    name: shape.properties.name as string,
    abbr: STATE_NAME_TO_ABBR[shape.properties.name as string] ?? "",
    d: path(shape) ?? "",
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
})();

const TEXAS_MAP: ProjectionMap = (() => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const topo = statesTopo as any;
  const collection = feature(topo, topo.objects.states) as any;
  const texasFeature = (collection.features as any[]).find(
    (shape) =>
      (STATE_NAME_TO_ABBR[shape.properties.name as string] ?? "") === TEXAS_STATE
  );
  const projection = geoAlbersUsa().fitExtent(
    [
      [MAP_PADDING, MAP_PADDING],
      [WIDTH - MAP_PADDING, HEIGHT - MAP_PADDING],
    ],
    texasFeature
  );
  const path = geoPath(projection);

  return {
    project(longitude: number, latitude: number) {
      return projection([longitude, latitude]);
    },
    shapes: [
      {
        name: texasFeature.properties.name as string,
        abbr: TEXAS_STATE,
        d: path(texasFeature) ?? "",
      },
    ],
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
})();

function heatColor(intensity: number) {
  const alpha = 0.15 + intensity * 0.85;
  return `rgba(29, 78, 138, ${alpha})`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCityMarkerPoint(city: CityPoint) {
  const offset = CITY_MARKER_OFFSETS[normalizeCityKey(city.city)] ?? {
    dx: 0,
    dy: 0,
  };

  return {
    isOffset: offset.dx !== 0 || offset.dy !== 0,
    x: clamp(city.x + offset.dx, MAP_PADDING + 18, WIDTH - MAP_PADDING - 18),
    y: clamp(city.y + offset.dy, MAP_PADDING + 18, HEIGHT - MAP_PADDING - 18),
  };
}

function normalizeCityKey(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function percentOf(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return 0;

  return (value / total) * 100;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCurrencyShort(value: number) {
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (absValue >= 1000000) {
    return `${sign}$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(absValue / 1000000)}M`;
  }

  if (absValue >= 1000) {
    return `${sign}$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    }).format(absValue / 1000)}K`;
  }

  return `${sign}$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(absValue)}`;
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Math.abs(value) >= 10 ? 1 : 0,
  }).format(value)}%`;
}

export function PcStateHeatMap({
  counts,
  groups,
}: {
  counts: Record<string, number>;
  groups?: PcStateMapGroup[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<MapTooltip | null>(null);

  const maxCount = useMemo(
    () => Math.max(1, ...Object.values(counts)),
    [counts]
  );
  const statesWithPolicies = useMemo(
    () => Object.values(counts).filter((count) => count > 0).length,
    [counts]
  );
  const totalPolicies = useMemo(
    () => Object.values(counts).reduce((total, count) => total + count, 0),
    [counts]
  );
  const texasCities = useMemo(() => {
    const texasGroup = groups?.find((group) => group.state === TEXAS_STATE);
    const cityRows =
      texasGroup?.rows
        .filter((row) => !row.isTotal && row.policyCount > 0 && row.city !== "Unknown")
        .sort(
          (left, right) =>
            right.policyCount - left.policyCount ||
            right.totalPremium - left.totalPremium ||
            left.city.localeCompare(right.city)
        ) ?? [];

    return cityRows
      .map((row) => {
        const coords = TEXAS_CITY_COORDS[normalizeCityKey(row.city)];
        if (!coords) return null;
        const point = TEXAS_MAP.project(coords.longitude, coords.latitude);
        if (!point) return null;

        return {
          ...row,
          latitude: coords.latitude,
          longitude: coords.longitude,
          x: point[0],
          y: point[1],
        };
      })
      .filter((row): row is CityPoint => row !== null);
  }, [groups]);
  const topCityRows = texasCities.slice(0, CITY_ROW_LIMIT);
  const maxCityPolicies = useMemo(
    () => Math.max(1, ...topCityRows.map((city) => city.policyCount)),
    [topCityRows]
  );
  const topCityPolicies = topCityRows.reduce(
    (total, city) => total + city.policyCount,
    0
  );
  const texasPolicies = counts[TEXAS_STATE] ?? 0;
  const outOfStatePolicies = Math.max(totalPolicies - texasPolicies, 0);
  const showTexasCityMap = texasCities.length > 0;

  function handleMove(event: MouseEvent, title: string, lines: string[]) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      lines,
      title,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  if (showTexasCityMap) {
    return (
      <section className="flex flex-col">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold leading-tight text-slate-800">
            Top 5 Texas Cities | Policies & Premium
          </h3>
          <span className="text-xs font-medium text-slate-500">
            Only the top {topCityRows.length} cities are plotted
          </span>
        </div>

        <div
          ref={containerRef}
          className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow duration-300 hover:shadow-md"
          onMouseLeave={() => setHover(null)}
        >
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-lg bg-[#f8fbff] p-4">
              <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className="block w-full"
                role="img"
                aria-label="Texas map of top five policy cities"
              >
                <defs>
                  <filter
                    id="city-marker-shadow"
                    height="170%"
                    width="170%"
                    x="-35%"
                    y="-35%"
                  >
                    <feDropShadow
                      dx="0"
                      dy="8"
                      floodColor="#0f172a"
                      floodOpacity="0.16"
                      stdDeviation="7"
                    />
                  </filter>
                </defs>
                <rect width={WIDTH} height={HEIGHT} rx="18" fill="#f8fbff" />
                {TEXAS_MAP.shapes.map((shape) => (
                  <path
                    key={shape.name}
                    d={shape.d}
                    fill="#e8f1fb"
                    stroke="#cbd9e8"
                    strokeWidth={1.2}
                  />
                ))}
                {topCityRows.map((city, index) => {
                  const markerPoint = getCityMarkerPoint(city);
                  const radius =
                    13 +
                    Math.sqrt(city.policyCount / Math.max(maxCityPolicies, 1)) * 18;
                  const markerColor =
                    TOP_CITY_MARKER_COLORS[index % TOP_CITY_MARKER_COLORS.length];

                  return (
                    <g key={`${city.state}-${city.city}`}>
                      {markerPoint.isOffset ? (
                        <>
                          <line
                            x1={city.x}
                            x2={markerPoint.x}
                            y1={city.y}
                            y2={markerPoint.y}
                            stroke="#93a7bd"
                            strokeDasharray="4 5"
                            strokeWidth={1.4}
                          />
                          <circle
                            cx={city.x}
                            cy={city.y}
                            fill="#1d4e8a"
                            opacity={0.28}
                            r={3.8}
                          />
                        </>
                      ) : null}
                      <circle
                        cx={markerPoint.x}
                        cy={markerPoint.y}
                        filter="url(#city-marker-shadow)"
                        opacity={0.18}
                        r={radius + 7}
                        fill={markerColor}
                      />
                      <circle
                        cx={markerPoint.x}
                        cy={markerPoint.y}
                        r={radius}
                        fill={markerColor}
                        stroke="#ffffff"
                        strokeWidth={3}
                        className="cursor-pointer transition-opacity duration-150 hover:opacity-90"
                        onMouseMove={(event) =>
                          handleMove(event, `#${index + 1} ${city.city}`, [
                            `${formatInteger(city.policyCount)} policies`,
                            `${formatPercent(city.policySharePercent)} of portfolio`,
                            `${formatCurrencyShort(city.totalPremium)} premium`,
                            `${formatCurrencyShort(city.totalCommission)} commission`,
                          ])
                        }
                      />
                      <text
                        className="pointer-events-none fill-white text-[15px] font-bold"
                        dominantBaseline="central"
                        textAnchor="middle"
                        x={markerPoint.x}
                        y={markerPoint.y + 1}
                      >
                        {index + 1}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500">
                <div className="flex items-center gap-2">
                  <span>Marker size = policies</span>
                  <span className="h-3 w-3 rounded-full bg-[#1d4e8a]/50" />
                  <span className="h-5 w-5 rounded-full bg-[#1d4e8a]/60" />
                  <span className="h-8 w-8 rounded-full bg-[#1d4e8a]/70" />
                </div>
                <span>Numbers match the city ranking</span>
              </div>
            </div>

            <aside className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <MapStat
                  label="Texas share"
                  value={formatPercent(percentOf(texasPolicies, totalPolicies))}
                />
                <MapStat
                  label="Top 5 share"
                  value={formatPercent(percentOf(topCityPolicies, totalPolicies))}
                />
                <MapStat
                  label="Out of state"
                  value={formatInteger(outOfStatePolicies)}
                />
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                    Top Texas cities
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Policies drive the rank. Premium shown as the secondary value.
                  </div>
                </div>
                <div className="divide-y divide-slate-100">
                  {topCityRows.map((city, index) => {
                    const markerColor =
                      TOP_CITY_MARKER_COLORS[index % TOP_CITY_MARKER_COLORS.length];
                    const barWidth = `${Math.max(
                      8,
                      (city.policyCount / Math.max(maxCityPolicies, 1)) * 100
                    )}%`;

                    return (
                    <div
                      key={`rank-${city.city}`}
                      className="px-4 py-3 text-sm"
                    >
                      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                          style={{ backgroundColor: markerColor }}
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-800">
                            {city.city}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {formatPercent(city.policySharePercent)} share
                          </div>
                        </div>
                        <div className="text-right tabular-nums">
                          <div className="font-bold text-slate-800">
                            {formatInteger(city.policyCount)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {formatCurrencyShort(city.totalPremium)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{
                            backgroundColor: markerColor,
                            width: barWidth,
                          }}
                        />
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            </aside>
          </div>

          {hover ? <MapTooltipCard hover={hover} /> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold leading-tight text-slate-800">
          Policies by State | Customer Concentration
        </h3>
        <span className="text-xs font-medium text-slate-500">
          {statesWithPolicies} states with policies
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow duration-300 hover:shadow-md"
        onMouseLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block w-full"
          role="img"
          aria-label="US map of policy counts by state"
        >
          {STATE_SHAPES.map((shape) => {
            const count = counts[shape.abbr] ?? 0;

            return (
              <path
                key={shape.name}
                d={shape.d}
                fill={count === 0 ? "#eef2f7" : heatColor(count / maxCount)}
                stroke="#ffffff"
                strokeWidth={0.75}
                className="cursor-pointer transition-[fill] duration-150 hover:stroke-[#16233a]"
                onMouseMove={(event) =>
                  handleMove(event, shape.name, [
                    `${count.toLocaleString("en-US")} policies`,
                  ])
                }
              />
            );
          })}
        </svg>

        {hover ? <MapTooltipCard hover={hover} /> : null}

        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
          <span>0</span>
          <div
            className="h-2 w-40 rounded-full"
            style={{
              background:
                "linear-gradient(to right, #eef2f7, rgba(29,78,138,0.18), rgba(29,78,138,1))",
            }}
          />
          <span>{maxCount.toLocaleString("en-US")}</span>
          <span className="ml-1">policies</span>
        </div>
      </div>
    </section>
  );
}

function MapStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-bold tabular-nums text-slate-800">
        {value}
      </div>
    </div>
  );
}

function MapTooltipCard({ hover }: { hover: MapTooltip }) {
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-[#d8dee7] bg-white px-3 py-1.5 text-xs shadow-lg"
      style={{ left: hover.x + 14, top: hover.y + 14 }}
    >
      <div className="font-semibold text-[#16233a]">{hover.title}</div>
      {hover.lines.map((line) => (
        <div key={line} className="text-[#475569]">
          {line}
        </div>
      ))}
    </div>
  );
}

"use client";

import { useMemo, useRef, useState, type MouseEvent } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import statesTopo from "us-atlas/states-10m.json";

const WIDTH = 960;
const HEIGHT = 560;

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

function heatColor(intensity: number) {
  const alpha = 0.15 + intensity * 0.85;
  return `rgba(29, 78, 138, ${alpha})`;
}

export function PcStateHeatMap({ counts }: { counts: Record<string, number> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    name: string;
    count: number;
    x: number;
    y: number;
  } | null>(null);

  const maxCount = useMemo(
    () => Math.max(1, ...Object.values(counts)),
    [counts]
  );
  const statesWithPolicies = useMemo(
    () => Object.values(counts).filter((count) => count > 0).length,
    [counts]
  );

  function handleMove(event: MouseEvent, name: string, count: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      name,
      count,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
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
                onMouseMove={(event) => handleMove(event, shape.name, count)}
              />
            );
          })}
        </svg>

        {hover ? (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-[#d8dee7] bg-white px-3 py-1.5 text-xs shadow-lg"
            style={{ left: hover.x + 14, top: hover.y + 14 }}
          >
            <div className="font-semibold text-[#16233a]">{hover.name}</div>
            <div className="text-[#475569]">
              {hover.count.toLocaleString("en-US")} policies
            </div>
          </div>
        ) : null}

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

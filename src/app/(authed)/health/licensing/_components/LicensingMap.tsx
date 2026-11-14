"use client";

import { useMemo, useRef, useState } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import statesTopo from "us-atlas/states-10m.json";
import type { LicensingAppointment, LicensingProduct } from "@/lib/health-licensing/types";
import { US_STATE_CODE_BY_NAME, US_STATES } from "@/lib/us-states";
import type { MapFill } from "./licensing-view";

const VIEW_W = 1000;
const VIEW_H = 560;
const CALLOUT_X = 922;
/** Bang quá nhỏ để ghi mã bên trong: ghi ở cột bên phải, có đường chỉ. */
const CALLOUT_STATES = new Set(["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC"]);
/** Dời nhãn khỏi tâm hình học cho các bang hình dạng lạ. */
const LABEL_NUDGE: Record<string, [number, number]> = {
  FL: [16, 6], LA: [-10, 0], MI: [12, 22], KY: [6, 2], ID: [0, 22], OK: [12, 0], CA: [-10, 4],
  VA: [10, 4], WV: [-4, 6], NC: [6, 0], TN: [4, 0], MN: [-6, 0], NY: [6, 0], ME: [2, 4],
};

type Shape = { code: string; d: string };
/** Làm tròn 1 chữ số: server và trình duyệt tính centroid lệch ở chữ số thứ 13 → lỗi hydrate. */
const r1 = (n: number) => Math.round(n * 10) / 10;
type Label = { code: string; x: number; y: number; line?: { x1: number; y1: number } };

const GEOMETRY: { shapes: Shape[]; labels: Label[] } = (() => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const topo = statesTopo as any;
  const collection = feature(topo, topo.objects.states) as any;
  const features = (collection.features as any[]).filter((f) => US_STATE_CODE_BY_NAME[f.properties.name]);
  const path = geoPath(geoAlbersUsa().fitExtent([[6, 8], [900, 552]], { type: "FeatureCollection", features } as any));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const shapes: Shape[] = [];
  const labels: Label[] = [];
  const callouts: Array<{ code: string; cx: number; cy: number }> = [];
  for (const f of features) {
    const code = US_STATE_CODE_BY_NAME[f.properties.name];
    const d = path(f);
    if (!d) continue;
    shapes.push({ code, d });
    const [rawX, rawY] = path.centroid(f);
    const cx = r1(rawX);
    const cy = r1(rawY);
    if (CALLOUT_STATES.has(code)) callouts.push({ code, cx, cy });
    else {
      const [dx, dy] = LABEL_NUDGE[code] ?? [0, 0];
      labels.push({ code, x: r1(cx + dx), y: r1(cy + dy) });
    }
  }
  callouts.sort((a, b) => a.cy - b.cy);
  let prev = -Infinity;
  for (const c of callouts) {
    const y = r1(Math.max(c.cy, prev + 19));
    prev = y;
    labels.push({ code: c.code, x: CALLOUT_X + 6, y, line: { x1: c.cx, y1: c.cy } });
  }
  return { shapes, labels };
})();

const FILL: Record<MapFill, string> = { active: "#579dff", pending: "url(#licensing-hatch)", none: "#e4e8ee" };

export function LicensingMap({
  fills,
  selected,
  appointments,
  products,
  onSelect,
}: {
  fills: Map<string, { fill: MapFill; dim: boolean }>;
  selected: string | null;
  appointments: readonly LicensingAppointment[];
  products: readonly LicensingProduct[];
  onSelect: (stateCode: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);

  const hoverRows = useMemo(() => {
    if (!hover) return [];
    return products.map((p) => ({
      label: p.label,
      count: appointments.filter((a) => a.stateCode === hover.code && a.columnId === p.columnId && a.status !== "terminated")
        .length,
    }));
  }, [hover, appointments, products]);

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const code = (event.target as Element).closest?.("[data-state]")?.getAttribute("data-state");
    const box = wrapRef.current?.getBoundingClientRect();
    if (!code || !box) return setHover(null);
    let x = event.clientX - box.left + 14;
    let y = event.clientY - box.top + 14;
    if (x + 210 > box.width) x = event.clientX - box.left - 210;
    if (y + 170 > box.height) y = event.clientY - box.top - 170;
    setHover({ code, x, y });
  }

  return (
    <div ref={wrapRef} className="relative flex min-h-0 flex-1 items-center justify-center p-3">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-full max-h-full w-full"
        role="img"
        aria-label="Map of licensed states"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern id="licensing-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#e9f2ff" />
            <rect width="3" height="6" fill="#85b8ff" />
          </pattern>
        </defs>
        <g>
          {GEOMETRY.shapes.map((shape) => {
            const state = fills.get(shape.code) ?? { fill: "none" as MapFill, dim: false };
            const isSelected = selected === shape.code;
            return (
              <path
                key={shape.code}
                data-state={shape.code}
                d={shape.d}
                fill={FILL[state.fill]}
                stroke={isSelected ? "#0c3a7a" : "#ffffff"}
                strokeWidth={isSelected ? 2.4 : 0.9}
                opacity={state.dim ? 0.25 : 1}
                className="cursor-pointer transition-opacity hover:brightness-[.92]"
                onClick={() => onSelect(shape.code)}
              >
                <title>{US_STATES[shape.code]}</title>
              </path>
            );
          })}
        </g>
        <g className="pointer-events-none" fontSize={12} fontWeight={700}>
          {GEOMETRY.labels.map((label) => {
            const state = fills.get(label.code);
            const on = state?.fill === "active" && !state.dim;
            const callout = Boolean(label.line);
            return (
              <g key={label.code}>
                {label.line ? (
                  <line x1={label.line.x1} y1={label.line.y1} x2={CALLOUT_X} y2={label.y} stroke="#b3bac5" strokeWidth={0.8} />
                ) : null}
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor={callout ? "start" : "middle"}
                  dominantBaseline="central"
                  fill={on ? (callout ? "#0c66e4" : "#ffffff") : "#8993a4"}
                  fontWeight={on ? 700 : 600}
                >
                  {label.code}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {hover ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[190px] rounded-lg border border-[#dfe1e6] bg-white px-3 py-2 text-[13px] shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="mb-1 font-bold text-[#172b4d]">
            {US_STATES[hover.code]} <span className="font-mono text-[#97a0af]">{hover.code}</span>
          </div>
          {hoverRows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4 py-0.5">
              <span className="text-[#6b778c]">{row.label}</span>
              <span className={`font-semibold tabular-nums ${row.count ? "text-[#172b4d]" : "text-[#97a0af]"}`}>
                {row.count || "—"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";

/**
 * Phone layout (< 768px) shared by the dashboard trend charts: bars on the left
 * axis, lines on the right axis, all periods fitting one screen width.
 *
 * The desktop charts print a number over every bar and point; at phone width
 * those collide, so here the numbers live in a strip above the chart. It shows
 * the latest period until a bar is tapped, so it doubles as the legend.
 */
export type PhoneTrendSeries = {
  label: string;
  color: string;
  values: number[];
  format: (value: number) => string;
};

const WIDTH = 360;
const HEIGHT = 220;
const LEFT = 40;
const RIGHT = 36;
const TOP = 10;
const BOTTOM = 26;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const GRID_TICKS = [0, 0.5, 1];
/** Room one short period label ("03/26") needs before the next is drawn. */
const MIN_LABEL_GAP = 38;

export function PhoneTrendChart({
  ariaLabel,
  periodLabels,
  bar,
  barMax,
  barAxisFormat,
  lines,
  lineMax,
  lineAxisFormat,
}: {
  ariaLabel: string;
  periodLabels: string[];
  bar: PhoneTrendSeries;
  barMax: number;
  barAxisFormat: (value: number) => string;
  lines: PhoneTrendSeries[];
  lineMax: number;
  lineAxisFormat: (value: number) => string;
}) {
  const [tappedIndex, setTappedIndex] = useState<number | null>(null);
  const count = periodLabels.length;
  if (count === 0) return null;

  // A metric or level switch can shrink the data under a stale tap.
  const activeIndex =
    tappedIndex !== null && tappedIndex < count ? tappedIndex : count - 1;
  const groupWidth = PLOT_WIDTH / count;
  const barWidth = Math.min(28, Math.max(6, groupWidth * 0.6));
  const labelStep = Math.max(1, Math.ceil(MIN_LABEL_GAP / groupWidth));
  const safeBarMax = barMax > 0 ? barMax : 1;
  const safeLineMax = lineMax > 0 ? lineMax : 1;
  const centerX = (index: number) => LEFT + index * groupWidth + groupWidth / 2;
  const toBarY = (value: number) =>
    TOP + PLOT_HEIGHT - (clampNumber(value) / safeBarMax) * PLOT_HEIGHT;
  const toLineY = (value: number) =>
    TOP + PLOT_HEIGHT - (Math.min(clampNumber(value), safeLineMax) / safeLineMax) * PLOT_HEIGHT;

  return (
    <div className="p-3">
      <div className="mb-2 rounded-lg bg-[#f6f8fb] px-3 py-2 text-xs">
        <div className="mb-1 font-semibold text-[#16233a]">{periodLabels[activeIndex]}</div>
        {[bar, ...lines].map((series, seriesIndex) => (
          <div key={series.label} className="flex items-center gap-2 py-0.5">
            {seriesIndex === 0 ? (
              <span className="h-2.5 w-3.5 shrink-0 rounded-sm" style={{ backgroundColor: series.color }} />
            ) : (
              <span className="h-0.5 w-3.5 shrink-0 rounded" style={{ backgroundColor: series.color }} />
            )}
            <span className="min-w-0 flex-1 truncate text-[#475467]">{series.label}</span>
            <span className="font-semibold text-[#16233a]">
              {series.format(series.values[activeIndex] ?? 0)}
            </span>
          </div>
        ))}
      </div>

      <svg className="block w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel}>
        {GRID_TICKS.map((tick) => {
          const y = TOP + PLOT_HEIGHT - tick * PLOT_HEIGHT;
          return (
            <g key={tick}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} stroke={tick === 0 ? "#b6b6b6" : "#e4e7ec"} />
              <text x={LEFT - 6} y={y + 3.5} textAnchor="end" className="fill-[#667085] text-[10px]">
                {barAxisFormat(safeBarMax * tick)}
              </text>
              <text x={WIDTH - RIGHT + 6} y={y + 3.5} className="fill-[#667085] text-[10px]">
                {lineAxisFormat(safeLineMax * tick)}
              </text>
            </g>
          );
        })}

        {periodLabels.map((label, index) => {
          const x = centerX(index);
          const isActive = index === activeIndex;
          const barY = toBarY(bar.values[index] ?? 0);
          // Count back from the latest period so the newest label always shows.
          const showLabel = (count - 1 - index) % labelStep === 0;
          return (
            <g key={`${label}-${index}`}>
              <rect
                x={x - barWidth / 2}
                y={barY}
                width={barWidth}
                height={Math.max(TOP + PLOT_HEIGHT - barY, 1.5)}
                fill={bar.color}
                stroke={isActive ? "#7c8594" : "none"}
                strokeWidth={isActive ? 1.2 : 0}
              />
              {showLabel ? (
                <text
                  x={x}
                  y={TOP + PLOT_HEIGHT + 16}
                  textAnchor="middle"
                  className={`text-[10px] ${isActive ? "fill-[#16233a] font-semibold" : "fill-[#667085]"}`}
                >
                  {shortPeriodLabel(label)}
                </text>
              ) : null}
            </g>
          );
        })}

        {lines.map((series) => (
          <g key={series.label}>
            <path
              d={series.values
                .map((value, index) => `${index === 0 ? "M" : "L"} ${centerX(index)} ${toLineY(value)}`)
                .join(" ")}
              fill="none"
              stroke={series.color}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {series.values.map((value, index) => (
              <circle
                key={index}
                cx={centerX(index)}
                cy={toLineY(value)}
                r={index === activeIndex ? 4 : 2.5}
                fill={series.color}
              />
            ))}
          </g>
        ))}

        <line
          x1={centerX(activeIndex)}
          x2={centerX(activeIndex)}
          y1={TOP}
          y2={TOP + PLOT_HEIGHT}
          stroke="#9aa3b2"
          strokeDasharray="3 3"
          pointerEvents="none"
        />

        {/* Tap targets on top: the whole column, not just the bar. */}
        {periodLabels.map((label, index) => (
          <rect
            key={`hit-${label}-${index}`}
            x={LEFT + index * groupWidth}
            y={TOP}
            width={groupWidth}
            height={PLOT_HEIGHT + BOTTOM}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => setTappedIndex(index)}
          />
        ))}
      </svg>
    </div>
  );
}

function clampNumber(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** "2026-03" → "03/26", "2026-Q1" / "2026 Q1" / "Q1, 2026" → "Q1/26"; years stay. */
export function shortPeriodLabel(label: string): string {
  const trimmed = label.trim();
  const month = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (month) return `${month[2]}/${month[1].slice(2)}`;
  const quarter = /^(\d{4})[-\s]Q([1-4])$/.exec(trimmed);
  if (quarter) return `Q${quarter[2]}/${quarter[1].slice(2)}`;
  const quarterFirst = /^Q([1-4]),?\s+(\d{4})$/.exec(trimmed);
  if (quarterFirst) return `Q${quarterFirst[1]}/${quarterFirst[2].slice(2)}`;
  return trimmed;
}

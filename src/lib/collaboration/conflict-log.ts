/** Safe diagnostics for optimistic-concurrency conflicts. */
export type ConflictStage = "precheck" | "write";

const TIMESTAMP_RE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

function isoZone(zone: string): string {
  if (zone === "Z") return "Z";
  const digits = zone.slice(1).replace(":", "");
  return `${zone[0]}${digits.slice(0, 2)}:${digits.slice(2, 4) || "00"}`;
}

/** Preserve the microseconds that Date.parse alone would discard. */
export function toEpochMicros(value: string): number | null {
  const match = TIMESTAMP_RE.exec(value.trim());
  if (!match) return null;
  const [, date, time, fraction = "", zone] = match;
  const millis = Date.parse(`${date}T${time}${isoZone(zone)}`);
  if (Number.isNaN(millis)) return null;
  return millis * 1000 + Number(fraction.padEnd(6, "0"));
}

export function conflictLogFields(input: {
  route: string;
  id: string;
  stage: ConflictStage;
  expected: string;
  current?: string | null;
}): {
  route: string;
  id: string;
  stage: ConflictStage;
  lag_ms: number | null;
  same_instant: boolean | null;
} {
  const expected = toEpochMicros(input.expected);
  const current = input.current ? toEpochMicros(input.current) : null;
  const lagMicros = expected !== null && current !== null ? current - expected : null;
  return {
    route: input.route,
    id: input.id,
    stage: input.stage,
    lag_ms: lagMicros === null ? null : Math.round(lagMicros / 1000),
    same_instant: lagMicros === null ? null : lagMicros === 0,
  };
}

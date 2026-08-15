import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SLA_MINUTES } from "./sla";
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderSettings,
} from "./reminder-settings";
import {
  REMINDER_FIELDS,
  SLA_DURATION_BOUNDS,
  SLA_HOUR_OPTIONS,
  SLA_MINUTE_OPTIONS,
  SLA_MINUTE_STEP,
  TASK_PRIORITY_LABEL,
  isSlaDurationInBounds,
  isUuid,
  normalizeSlaMinutesForHours,
  slaMinuteOptionsForHours,
} from "./sla-config";
import { TASK_PRIORITIES } from "./types";

const schemaSql = readFileSync(
  fileURLToPath(new URL("../../../supabase/schema.sql", import.meta.url)),
  "utf8"
);

describe("SLA defaults stay in sync with the database", () => {
  it("DEFAULT_SLA_MINUTES matches the task_sla_rules seed", () => {
    for (const priority of TASK_PRIORITIES) {
      const seeded = [
        ...schemaSql.matchAll(new RegExp(`\\('${priority}',\\s*(\\d+)\\)`, "g")),
      ];
      expect(seeded.length, `no seed row found for priority "${priority}"`).toBeGreaterThan(0);
      for (const match of seeded) {
        expect(Number(match[1])).toBe(DEFAULT_SLA_MINUTES[priority]);
      }
    }
  });

  it("DEFAULT_REMINDER_SETTINGS matches the task_reminder_settings column defaults", () => {
    const columnByField: Record<keyof ReminderSettings, string> = {
      dueSoonMinutes: "due_soon_minutes",
      todoHours: "todo_hours",
      overdueReminderHours: "overdue_reminder_hours",
      waitingHours: "waiting_hours",
      staleHours: "stale_hours",
      qcHours: "qc_hours",
    };

    for (const [field, column] of Object.entries(columnByField) as Array<
      [keyof ReminderSettings, string]
    >) {
      const declared = [
        ...schemaSql.matchAll(
          new RegExp(`${column}\\s+integer\\s+not null\\s+default\\s+(\\d+)`, "g")
        ),
      ];
      expect(declared.length, `no column default found for "${column}"`).toBeGreaterThan(0);
      for (const match of declared) {
        expect(Number(match[1])).toBe(DEFAULT_REMINDER_SETTINGS[field]);
      }
    }
  });

  it("every seeded SLA default is inside the allowed bounds", () => {
    for (const priority of TASK_PRIORITIES) {
      expect(isSlaDurationInBounds(DEFAULT_SLA_MINUTES[priority])).toBe(true);
    }
  });
});

describe("SLA config constants are derived, not re-typed", () => {
  it("REMINDER_FIELDS covers every ReminderSettings key exactly once", () => {
    const listed = REMINDER_FIELDS.map((field) => field.key).sort();
    const actual = (Object.keys(DEFAULT_REMINDER_SETTINGS) as Array<
      keyof ReminderSettings
    >).sort();
    expect(listed).toEqual(actual);
  });

  it("every priority has a display label", () => {
    for (const priority of TASK_PRIORITIES) {
      expect(TASK_PRIORITY_LABEL[priority]).toBeTruthy();
    }
  });

  it("hour options span 0h to the max bound", () => {
    expect(SLA_HOUR_OPTIONS[0]).toBe(0);
    expect(SLA_HOUR_OPTIONS.at(-1)).toBe(SLA_DURATION_BOUNDS.maxMinutes / 60);
  });

  it("minute options follow the declared step and stay under an hour", () => {
    expect(SLA_MINUTE_OPTIONS[0]).toBe(0);
    expect(SLA_MINUTE_OPTIONS.at(-1)).toBe(60 - SLA_MINUTE_STEP);
    for (const minute of SLA_MINUTE_OPTIONS) expect(minute % SLA_MINUTE_STEP).toBe(0);
  });

  it("keeps every composed hour/minute choice inside the duration bounds", () => {
    for (const hours of SLA_HOUR_OPTIONS) {
      for (const minute of slaMinuteOptionsForHours(hours)) {
        expect(isSlaDurationInBounds(hours * 60 + minute)).toBe(true);
      }
    }
  });

  it("clamps the minute choices at both duration boundaries", () => {
    expect(slaMinuteOptionsForHours(167)).toEqual([...SLA_MINUTE_OPTIONS]);
    expect(slaMinuteOptionsForHours(168)).toEqual([0]);
    expect(slaMinuteOptionsForHours(0)).toEqual(
      SLA_MINUTE_OPTIONS.filter((minute) => minute > 0)
    );
    expect(normalizeSlaMinutesForHours(168, 55)).toBe(0);
    expect(normalizeSlaMinutesForHours(0, 0)).toBe(5);
  });

  it("rejects out-of-bounds durations", () => {
    expect(isSlaDurationInBounds(0)).toBe(false);
    expect(isSlaDurationInBounds(-5)).toBe(false);
    expect(isSlaDurationInBounds(1.5)).toBe(false);
    expect(isSlaDurationInBounds(SLA_DURATION_BOUNDS.maxMinutes + 1)).toBe(false);
    expect(isSlaDurationInBounds(SLA_DURATION_BOUNDS.maxMinutes)).toBe(true);
  });

  it("accepts only UUID category identifiers", () => {
    expect(isUuid("00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});

import { resolveLeadAlerts, type LeadAlert } from "./alerts";
import type { LeadAlertSettings, LeadRow, LeadStatus } from "./types";

/**
 * One bucket per lead, covering every lead exactly once.
 *
 * The four alert flags answer "what is wrong", and a lead can carry more than
 * one of them. A filter needs the other question — "where does this lead
 * stand" — with an answer that is single-valued, so the counts add up to the
 * total and nothing hides in a gap between options.
 *
 * Order is the order of the list below: most in need of a phone call first,
 * then the three states where nobody is at fault.
 */
export const LEAD_HEALTH_BUCKETS = [
  "never_contacted",
  "follow_up_overdue",
  "stale",
  "exhausted",
  "on_track",
  "unassigned",
  "closed",
] as const;

export type LeadHealth = (typeof LEAD_HEALTH_BUCKETS)[number];

/** Precedence when a lead trips several alerts: the most actionable wins. */
const ALERT_PRECEDENCE: LeadAlert[] = [
  "never_contacted",
  "follow_up_overdue",
  "stale",
  "exhausted",
];

export function isLeadHealth(value: unknown): value is LeadHealth {
  return (
    typeof value === "string" &&
    (LEAD_HEALTH_BUCKETS as readonly string[]).includes(value)
  );
}

/**
 * Mirrors resolveLeadAlerts' own early exits in the same order, so a lead can
 * never be bucketed as needing a call while its badges say otherwise:
 *
 *   closed      — a won or lost status; the work is finished either way
 *   unassigned  — nobody has been given it, so nobody is late
 *   on_track    — assigned, worked, and no flag raised
 */
export function classifyLeadHealth(
  lead: LeadRow,
  status: LeadStatus | null,
  settings: LeadAlertSettings | null,
  now: Date = new Date()
): LeadHealth {
  if (status && (status.kind === "won" || status.kind === "lost")) {
    return "closed";
  }
  if (!lead.assigned_to_email || !lead.assigned_at) return "unassigned";

  const alerts = resolveLeadAlerts(lead, status, settings, now);
  for (const alert of ALERT_PRECEDENCE) {
    if (alerts.includes(alert)) return alert;
  }
  return "on_track";
}

export function emptyLeadHealthCounts(): Record<LeadHealth, number> {
  return {
    never_contacted: 0,
    follow_up_overdue: 0,
    stale: 0,
    exhausted: 0,
    on_track: 0,
    unassigned: 0,
    closed: 0,
  };
}

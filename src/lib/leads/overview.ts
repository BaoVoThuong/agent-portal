import { ALERT_SEVERITY, resolveLeadAlerts, type LeadAlert } from "./alerts";
import {
  isLeadProduct,
  type LeadAlertSettings,
  type LeadProduct,
  type LeadRow,
  type LeadStatus,
} from "./types";

/**
 * null = every product. Deliberately NOT toLeadProduct(), which falls back to
 * "pc": that fallback is right for a URL that names a product and wrong here,
 * where "no product given" means "show me all of them". The same trap emptied
 * the merged lead list on 31/08 — this is the copy in the Overview.
 */
export function parseOverviewProduct(value: unknown): LeadProduct | null {
  return isLeadProduct(value) ? value : null;
}

/**
 * Alert thresholds are per product, so a list that mixes products needs both
 * rows and picks per lead. Passing one row for a mixed list measures P&C leads
 * against Health's thresholds.
 */
export type LeadAlertSettingsByProduct = Record<LeadProduct, LeadAlertSettings>;

export function settingsForLead(
  settings: LeadAlertSettings | LeadAlertSettingsByProduct,
  product: LeadProduct
): LeadAlertSettings {
  return "product" in settings ? settings : settings[product];
}

export type AgentSummary = {
  email: string;
  total: number;
  redCount: number;
  amberCount: number;
  won: number;
};

export type EventSummary = {
  eventId: string | null;
  total: number;
  won: number;
  closed: number;
  winRate: number | null;
};

export type LeadSummary = {
  total: number;
  unassigned: number;
  byAlert: Record<LeadAlert, number>;
  byAgent: AgentSummary[];
  byEvent: EventSummary[];
};

export function summarizeLeads(
  leads: readonly LeadRow[],
  statusById: ReadonlyMap<string, LeadStatus>,
  settings: LeadAlertSettings | LeadAlertSettingsByProduct,
  now: Date = new Date()
): LeadSummary {
  const byAlert: Record<LeadAlert, number> = {
    never_contacted: 0,
    stale: 0,
    follow_up_overdue: 0,
    exhausted: 0,
  };
  const agents = new Map<string, AgentSummary>();
  const events = new Map<string | null, EventSummary>();
  let unassigned = 0;

  for (const lead of leads) {
    const status = lead.status_id ? statusById.get(lead.status_id) ?? null : null;
    const alerts = resolveLeadAlerts(
      lead,
      status,
      settingsForLead(settings, lead.product),
      now,
    );
    for (const alert of alerts) byAlert[alert] += 1;

    const isWon = status?.kind === "won";
    const isClosed = status?.kind === "won" || status?.kind === "lost";
    const event = events.get(lead.event_id) ?? {
      eventId: lead.event_id,
      total: 0,
      won: 0,
      closed: 0,
      winRate: null,
    };
    event.total += 1;
    if (isWon) event.won += 1;
    if (isClosed) event.closed += 1;
    events.set(lead.event_id, event);

    if (!lead.assigned_to_email) {
      unassigned += 1;
      continue;
    }
    const key = lead.assigned_to_email.trim().toLowerCase();
    const agent = agents.get(key) ?? { email: key, total: 0, redCount: 0, amberCount: 0, won: 0 };
    agent.total += 1;
    if (isWon) agent.won += 1;
    for (const alert of alerts) {
      if (ALERT_SEVERITY[alert] === "red") agent.redCount += 1;
      else agent.amberCount += 1;
    }
    agents.set(key, agent);
  }

  for (const event of events.values()) {
    event.winRate = event.closed > 0 ? event.won / event.closed : null;
  }

  return {
    total: leads.length,
    unassigned,
    byAlert,
    byAgent: [...agents.values()].sort(
      (a, b) => b.redCount - a.redCount || b.total - a.total || a.email.localeCompare(b.email)
    ),
    byEvent: [...events.values()].sort(
      (a, b) => b.total - a.total || (a.eventId ?? "").localeCompare(b.eventId ?? "")
    ),
  };
}

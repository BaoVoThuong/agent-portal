"use client";

import { useEffect, useMemo, useState } from "react";
import { personLabel } from "@/lib/tasks/people";
import { Initials } from "../../tasks/_components/board-ui";
import type { LeadAlert } from "@/lib/leads/alerts";
import type { LeadSummary } from "@/lib/leads/overview";

type OverviewEvent = { id: string; name: string; event_date: string | null };

type LeadOverviewProps = {
  productFilter: "pc" | "health" | null;
  onAlertClick: (alert: LeadAlert) => void;
};

const ALERTS: Array<{ key: LeadAlert; label: string; tone: "red" | "amber" }> =
  [
    { key: "never_contacted", label: "No one called", tone: "red" },
    { key: "stale", label: "Gone stale", tone: "red" },
    { key: "follow_up_overdue", label: "Follow-up overdue", tone: "red" },
    { key: "exhausted", label: "Could not reach", tone: "amber" },
  ];

export function LeadOverview({ productFilter, onAlertClick }: LeadOverviewProps) {
  const [summary, setSummary] = useState<LeadSummary | null>(null);
  const [events, setEvents] = useState<OverviewEvent[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (state !== "idle") return;
    void fetch(`/api/leads/overview${productFilter ? `?product=${productFilter}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(payload?.error ?? "Could not load overview.");
        if (!payload?.summary) throw new Error("Could not load overview.");
        setSummary(payload.summary as LeadSummary);
        setEvents(
          Array.isArray(payload.events)
            ? (payload.events as OverviewEvent[])
            : [],
        );
        setTruncated(payload.truncated === true);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [state, productFilter]);

  const eventNames = useMemo(
    () => new Map(events.map((event) => [event.id, event.name])),
    [events],
  );

  if (state === "error")
    return (
      <p className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
        Could not load lead overview.
      </p>
    );
  if (!summary)
    return (
      <p className="border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-4 py-12 text-center text-sm font-semibold text-[#6b778c]">
        Loading overview...
      </p>
    );

  // Say it out loud rather than showing confident numbers that are quietly a
  // prefix of the truth. A manager decides who to reassign from this screen.
  const cap = truncated ? (
    <p
      role="alert"
      className="mb-3 border border-[#ffbdad] bg-[#ffebe6] px-4 py-3 text-sm font-semibold text-[#bf2600]"
    >
      Too many leads to summarise at once — these counts cover only the first
      20,000 and are lower than the real totals.
    </p>
  ) : null;

  return (
    <>
      {cap}
      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ALERTS.map((alert) => (
            <button
              key={alert.key}
              type="button"
              onClick={() => onAlertClick(alert.key)}
              className={`border bg-white p-4 text-left shadow-[0_1px_2px_rgba(22,35,58,0.04)] transition hover:border-[#93c5fd] hover:bg-[#f8fbff] ${alert.tone === "red" ? "border-rose-200" : "border-amber-200"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${alert.tone === "red" ? "bg-rose-500" : "bg-amber-400"}`}
                  />
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#667085]">
                    {alert.label}
                  </span>
                </span>
                <span className="text-xs font-bold text-[#0c66e4]">View</span>
              </div>
              <p
                className={`mt-4 text-3xl font-bold leading-none ${alert.tone === "red" ? "text-rose-700" : "text-amber-700"}`}
              >
                {summary.byAlert[alert.key].toLocaleString()}
              </p>
            </button>
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="overflow-hidden border border-[#dbe2eb] bg-white shadow-[0_1px_2px_rgba(22,35,58,0.04)]">
            <header className="border-b border-[#e6eaf0] px-4 py-4 sm:px-5">
              <h2 className="text-sm font-bold text-[#172b4d]">
                Agent workload
              </h2>
              <p className="mt-1 text-xs text-[#667085]">
                Active leads by owner and alert pressure.
              </p>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#f8fafc] text-[10px] font-bold uppercase tracking-[0.06em] text-[#667085]">
                  <tr>
                    <th className="px-4 py-2">Agent</th>
                    <th className="px-4 py-2">Total</th>
                    <th className="px-4 py-2">Red</th>
                    <th className="px-4 py-2">Amber</th>
                    <th className="px-4 py-2">Won</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef1f5]">
                  {summary.byAgent.map((agent) => (
                    <tr key={agent.email}>
                      <td className="px-4 py-2.5 font-medium text-[#344054]">
                        <span className="flex min-w-0 items-center gap-2">
                          <Initials
                            email={agent.email}
                            label={personLabel(agent.email)}
                          />
                          <span className="truncate">
                            {personLabel(agent.email)}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5">{agent.total}</td>
                      <td className="px-4 py-2.5 font-semibold text-red-600">
                        {agent.redCount}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-amber-600">
                        {agent.amberCount}
                      </td>
                      <td className="px-4 py-2.5">{agent.won}</td>
                    </tr>
                  ))}
                  {summary.byAgent.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-[#6b778c]"
                      >
                        No assigned leads.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="overflow-hidden border border-[#dbe2eb] bg-white shadow-[0_1px_2px_rgba(22,35,58,0.04)]">
            <header className="border-b border-[#e6eaf0] px-4 py-4 sm:px-5">
              <h2 className="text-sm font-bold text-[#172b4d]">
                Event performance
              </h2>
              <p className="mt-1 text-xs text-[#667085]">
                Conversion by campaign or event.
              </p>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#f8fafc] text-[10px] font-bold uppercase tracking-[0.06em] text-[#667085]">
                  <tr>
                    <th className="px-4 py-2">Event</th>
                    <th className="px-4 py-2">Total</th>
                    <th className="px-4 py-2">Closed</th>
                    <th className="px-4 py-2">Won</th>
                    <th className="px-4 py-2">Win rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef1f5]">
                  {summary.byEvent.map((event) => (
                    <tr key={event.eventId ?? "unassigned"}>
                      <td className="px-4 py-2.5 font-medium">
                        {event.eventId
                          ? (eventNames.get(event.eventId) ?? event.eventId)
                          : "No event"}
                      </td>
                      <td className="px-4 py-2.5">{event.total}</td>
                      <td className="px-4 py-2.5">{event.closed}</td>
                      <td className="px-4 py-2.5">{event.won}</td>
                      <td className="px-4 py-2.5 font-semibold">
                        {event.winRate === null
                          ? "—"
                          : `${Math.round(event.winRate * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </>
  );
}

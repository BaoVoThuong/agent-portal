"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeadAlert } from "@/lib/leads/alerts";
import type { LeadSummary } from "@/lib/leads/overview";

type OverviewEvent = { id: string; name: string; event_date: string | null };

type LeadOverviewProps = {
  product: "pc" | "health";
  onAlertClick: (alert: LeadAlert) => void;
};

const ALERTS: Array<{ key: LeadAlert; label: string; tone: "red" | "amber" }> =
  [
    { key: "never_contacted", label: "No one called", tone: "red" },
    { key: "stale", label: "Gone stale", tone: "red" },
    { key: "follow_up_overdue", label: "Follow-up overdue", tone: "red" },
    { key: "exhausted", label: "Could not reach", tone: "amber" },
  ];

export function LeadOverview({ product, onAlertClick }: LeadOverviewProps) {
  const [summary, setSummary] = useState<LeadSummary | null>(null);
  const [events, setEvents] = useState<OverviewEvent[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (state !== "idle") return;
    void fetch(`/api/leads/overview?product=${product}`, { cache: "no-store" })
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
  }, [state, product]);

  const eventNames = useMemo(
    () => new Map(events.map((event) => [event.id, event.name])),
    [events],
  );

  if (state === "error")
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
        Could not load lead overview.
      </p>
    );
  if (!summary)
    return (
      <p className="rounded-lg border border-[#d8dee7] bg-white px-4 py-8 text-center text-sm text-[#6b778c]">
        Loading overview...
      </p>
    );

  // Say it out loud rather than showing confident numbers that are quietly a
  // prefix of the truth. A manager decides who to reassign from this screen.
  const cap = truncated ? (
    <p
      role="alert"
      className="rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-4 py-3 text-sm font-semibold text-[#bf2600]"
    >
      Too many leads to summarise at once — these counts cover only the first
      20,000 and are lower than the real totals.
    </p>
  ) : null;

  return (
    <>
      {cap}
      <section className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ALERTS.map((alert) => (
            <button
              key={alert.key}
              type="button"
              onClick={() => onAlertClick(alert.key)}
              className={`rounded-lg border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${alert.tone === "red" ? "border-red-200" : "border-amber-200"}`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${alert.tone === "red" ? "bg-red-500" : "bg-amber-400"}`}
              />
              <p className="mt-3 text-xs font-bold uppercase tracking-[0.06em] text-[#6b778c]">
                {alert.label}
              </p>
              <p
                className={`mt-1 text-3xl font-bold ${alert.tone === "red" ? "text-red-600" : "text-amber-600"}`}
              >
                {summary.byAlert[alert.key].toLocaleString()}
              </p>
            </button>
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-sm">
            <header className="border-b border-[#e6eaf0] px-4 py-3">
              <h2 className="font-semibold text-[#172b4d]">Agent workload</h2>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#f7f8fa] text-xs uppercase text-[#6b778c]">
                  <tr>
                    <th className="px-4 py-2">Agent</th>
                    <th className="px-4 py-2">Total</th>
                    <th className="px-4 py-2">Red</th>
                    <th className="px-4 py-2">Amber</th>
                    <th className="px-4 py-2">Won</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6eaf0]">
                  {summary.byAgent.map((agent) => (
                    <tr key={agent.email}>
                      <td className="px-4 py-2.5 font-medium">{agent.email}</td>
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
          <section className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-sm">
            <header className="border-b border-[#e6eaf0] px-4 py-3">
              <h2 className="font-semibold text-[#172b4d]">
                Event performance
              </h2>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#f7f8fa] text-xs uppercase text-[#6b778c]">
                  <tr>
                    <th className="px-4 py-2">Event</th>
                    <th className="px-4 py-2">Total</th>
                    <th className="px-4 py-2">Closed</th>
                    <th className="px-4 py-2">Won</th>
                    <th className="px-4 py-2">Win rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6eaf0]">
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

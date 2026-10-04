"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Search, Shuffle, X } from "lucide-react";
import { fetchLeadEvents, peekLeadEvents, type LeadEventOption } from "@/lib/leads/events-cache";
import { pickWeighted } from "@/lib/leads/round-robin";
import {
  applyAgentToggle,
  parseAssignmentWeightRow,
  type AssignmentWeightRowView,
} from "@/lib/leads/assignment-weight-rows";
import { personLabel } from "@/lib/tasks/people";
import { Initials } from "../../_components/board-ui";
import { TaskSelect } from "../../_components/TaskSelect";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";
import { isPersonalLeadEventName } from "@/lib/leads/lead-type";

type WeightRow = AssignmentWeightRowView;
type WeightsPayload = { weights: WeightRow[] };
type PoolPayload = { pending: number; remaining: number };
type RosterAgent = { email: string; name: string | null; eventIds: string[] };
type DistributeResult = { assigned: number; unassigned: number; remaining: number; reason?: string };

const PREVIEW_SIZE = 10;
const INPUT_CLASS = "h-9 w-full rounded border border-[#dfe1e6] bg-white px-2 text-sm outline-none focus:border-[#0c66e4]";
const SELECT_CLASS = "!h-10 !rounded !border !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";

function eventLabel(event: LeadEventOption): string {
  return event.event_date ? `${event.name} · ${event.event_date}` : event.name;
}

/** Event-specific pool editor and distribution preview. */
export function LeadDistributeDialog({
  open,
  nameByEmail,
  sourceId,
  onClose,
  onDistributed,
}: {
  open: boolean;
  nameByEmail: Map<string, string>;
  sourceId: string;
  onClose: () => void;
  onDistributed: () => void;
}) {
  const [events, setEvents] = useState<LeadEventOption[]>(() => peekLeadEvents()?.events ?? []);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventId, setEventId] = useState("");
  const [roster, setRoster] = useState<RosterAgent[]>([]);
  const [rosterError, setRosterError] = useState(false);
  const [weights, setWeights] = useState<WeightsPayload | null>(null);
  const [draft, setDraft] = useState<WeightRow[]>([]);
  // Lọc danh sách Agent theo tên/email — danh sách dài thì khỏi phải cuộn tìm.
  const [agentQuery, setAgentQuery] = useState("");
  const [pool, setPool] = useState<PoolPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<DistributeResult | null>(null);
  const requestSequence = useRef(0);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setEventsLoading(true);
        return fetchLeadEvents();
      })
      .then((payload) => {
        if (cancelled || !payload) return;
        const activeEvents = payload.events.filter(
          (event) => event.id && event.name.trim() && !isPersonalLeadEventName(event.name),
        );
        setEvents(activeEvents);
        setEventId((current) => current && activeEvents.some((event) => event.id === current)
          ? current
          : activeEvents[0]?.id ?? "");
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load Events.");
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });

    void fetch("/api/leads/assignment-roster", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.agents)) throw new Error(payload?.error ?? "Could not load Agents.");
        if (!cancelled) {
          setRoster(payload.agents as RosterAgent[]);
          setRosterError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setRosterError(true);
      });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || !eventId) return;
    let cancelled = false;
    const sequence = ++requestSequence.current;
    void Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setLoading(true);
        setError(null);
        return Promise.all([
          fetch(`/api/leads/assignment-weights?event_id=${encodeURIComponent(eventId)}`, { cache: "no-store" }),
          fetch(`/api/leads/distribute?event_id=${encodeURIComponent(eventId)}`, { cache: "no-store" }),
        ]);
      })
      .then(async (responses) => {
        if (!responses) return;
        const [weightsResponse, poolResponse] = responses;
        const [weightsPayload, poolPayload] = await Promise.all([
          weightsResponse.json().catch(() => null),
          poolResponse.json().catch(() => null),
        ]);
        if (!weightsResponse.ok) throw new Error(weightsPayload?.error ?? "Could not load Event ratios.");
        if (!poolResponse.ok) throw new Error(poolPayload?.error ?? "Could not read the Event pool.");
        if (cancelled || sequence !== requestSequence.current) return;
        const rawWeights: unknown[] = Array.isArray(weightsPayload?.weights) ? weightsPayload.weights : [];
        const rows = rawWeights.map(parseAssignmentWeightRow).filter((row): row is WeightRow => row !== null);
        const next = { weights: rows };
        setWeights(next);
        setDraft(rows.map((row) => ({ ...row })));
        setPool({ pending: Number(poolPayload?.pending) || 0, remaining: Number(poolPayload?.remaining) || 0 });
      })
      .catch((loadError: unknown) => {
        if (!cancelled && sequence === requestSequence.current) {
          setWeights(null);
          setDraft([]);
          setPool(null);
          setError(loadError instanceof Error ? loadError.message : "Could not load the Event pool.");
        }
      })
      .finally(() => {
        if (!cancelled && sequence === requestSequence.current) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, eventId]);

  const agentsByEmail = useMemo(() => {
    const agents = new Map(roster.map((agent) => [agent.email.trim().toLowerCase(), agent]));
    for (const row of draft) {
      if (!agents.has(row.agent_email.trim().toLowerCase())) {
        agents.set(row.agent_email.trim().toLowerCase(), { email: row.agent_email, name: null, eventIds: [] });
      }
    }
    return [...agents.values()].sort((a, b) => personLabel(a.email, nameByEmail).localeCompare(personLabel(b.email, nameByEmail)));
  }, [draft, nameByEmail, roster]);

  const normalizedAgentQuery = foldSearch(agentQuery);
  const visibleAgents = normalizedAgentQuery
    ? agentsByEmail.filter((agent) =>
        foldSearch(`${personLabel(agent.email, nameByEmail)} ${agent.email}`).includes(normalizedAgentQuery),
      )
    : agentsByEmail;

  const activeRows = draft.filter((row) => row.is_active && row.weight > 0);
  const totalWeight = activeRows.reduce((sum, row) => sum + row.weight, 0);
  const shareOf = (row: WeightRow) => totalWeight > 0 && row.is_active && row.weight > 0
    ? Math.round((row.weight / totalWeight) * 1000) / 10
    : 0;
  const signature = (rows: WeightRow[]) => JSON.stringify(rows.map((row) => [row.agent_email, row.weight, row.position, row.is_active]));
  const dirty = weights !== null && signature(draft) !== signature(weights.weights);
  const upcoming = pickWeighted(activeRows.map((row) => ({
    email: row.agent_email,
    weight: row.weight,
    currentWeight: row.current_weight,
    position: row.position,
  })), PREVIEW_SIZE).picks;
  const selectedEvent = events.find((event) => event.id === eventId);

  function toggleAgent(email: string, checked: boolean) {
    setDraft((current) => applyAgentToggle(current, email, checked) as WeightRow[]);
  }

  function updateWeight(email: string, value: string) {
    const weight = Math.max(0, Math.trunc(Number(value) || 0));
    setDraft((current) => current.map((row) => row.agent_email === email ? { ...row, weight } : row));
  }

  async function reloadEventData() {
    if (!eventId) return;
    const [weightsResponse, poolResponse] = await Promise.all([
      fetch(`/api/leads/assignment-weights?event_id=${encodeURIComponent(eventId)}`, { cache: "no-store" }),
      fetch(`/api/leads/distribute?event_id=${encodeURIComponent(eventId)}`, { cache: "no-store" }),
    ]);
    const [weightsPayload, poolPayload] = await Promise.all([
      weightsResponse.json().catch(() => null), poolResponse.json().catch(() => null),
    ]);
    if (!weightsResponse.ok) throw new Error(weightsPayload?.error ?? "Could not reload Event ratios.");
    if (!poolResponse.ok) throw new Error(poolPayload?.error ?? "Could not reload the Event pool.");
    const rawWeights: unknown[] = Array.isArray(weightsPayload?.weights) ? weightsPayload.weights : [];
    const rows = rawWeights.map(parseAssignmentWeightRow).filter((row): row is WeightRow => row !== null);
    const next = { weights: rows };
    setWeights(next);
    setDraft(rows.map((row) => ({ ...row })));
    setPool({ pending: Number(poolPayload?.pending) || 0, remaining: Number(poolPayload?.remaining) || 0 });
  }

  async function save(): Promise<boolean> {
    if (busy || !eventId) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/leads/assignment-weights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          weights: draft.map(({ agent_email, weight, position, is_active }) => ({ agent_email, weight, position, is_active })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not save Event ratios.");
      await reloadEventData();
      setNotice("Event ratios saved.");
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save Event ratios.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function resetCursor() {
    if (!eventId || busy) return;
    if (!window.confirm(`Reset the rotation for ${selectedEvent?.name ?? "this Event"}? The next run starts a new cycle.`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/leads/assignment-weights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_cursor", event_id: eventId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not reset rotation.");
      await reloadEventData();
      setNotice("Rotation reset.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not reset rotation.");
    } finally {
      setBusy(false);
    }
  }

  async function distribute() {
    if (!eventId || busy || !pool?.pending || activeRows.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/leads/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-lead-client-source": sourceId },
        body: JSON.stringify({ event_id: eventId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not distribute this Event pool.");
      setResult(payload as DistributeResult);
      await reloadEventData();
      onDistributed();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Could not distribute this Event pool.");
    } finally {
      setBusy(false);
    }
  }

  async function saveThenDistribute() {
    if (dirty && !(await save())) return;
    await distribute();
  }

  if (!open) return null;
  const blockedReason = loading || eventsLoading
    ? "Loading Event pool…"
    : !eventId
      ? "Choose an Event."
      : activeRows.length === 0
        ? "Enable at least one Agent with a weight above 0."
        : !pool?.pending
          ? "No unassigned leads are waiting for this Event."
          : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Distribute Event pool" className="flex h-[calc(100vh-4rem)] max-h-[860px] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-[#dfe1e6] px-5 py-3">
          <div>
            <h2 className="text-base font-bold text-[#172b4d]">Distribute Event pool</h2>
            <p className="mt-0.5 text-xs text-[#6b778c]">Each Event keeps its own Agent list, ratios, and rotation.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1.5 text-[#42526e] transition hover:bg-[#f4f5f7]"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5">
          <div className="grid shrink-0 gap-3 sm:grid-cols-[minmax(15rem,0.8fr)_1fr]">
            <label className="block space-y-1">
              <span className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">Event</span>
              <TaskSelect
                label="Event"
                value={eventId}
                options={events.map((event) => ({ value: event.id, label: eventLabel(event) }))}
                placeholder={eventsLoading ? "Loading Events…" : "Choose Event"}
                disabled={eventsLoading || events.length === 0}
                searchable
                className="w-full"
                menuClassName="max-h-64 min-w-full"
                buttonClassName={SELECT_CLASS}
                onChange={(value) => {
                  setEventId(value);
                  setResult(null);
                  setError(null);
                  setNotice(null);
                }}
              />
              {events.length === 0 && !eventsLoading ? <span className="text-xs text-[#974f0c]">Create an Event before configuring a pool.</span> : null}
            </label>
            <div className="flex items-end">
              <div className="w-full rounded border border-[#dfe1e6] bg-[#f7f8fa] px-4 py-3 text-sm">
                {loading ? <span className="text-[#6b778c]">Loading this Event…</span> : pool ? (
                  pool.pending === 0 ? <span className="font-semibold text-[#42526e]">No unassigned leads for {selectedEvent?.name ?? "this Event"}.</span> : (
                    <>
                      <span className="font-semibold text-[#172b4d]">{pool.pending} unassigned lead{pool.pending === 1 ? "" : "s"}</span>
                      <span className="text-[#6b778c]"> for {selectedEvent?.name}</span>
                      {pool.remaining > 0 ? <span className="mt-1 block text-xs text-[#974f0c]">{pool.remaining} more will need another run.</span> : null}
                    </>
                  )
                ) : <span className="text-[#6b778c]">Choose an Event to read its pool.</span>}
              </div>
            </div>
          </div>


          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#dfe1e1]">
            <label className="relative block shrink-0 border-b border-[#dfe1e1] bg-white px-3 py-2">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8993a4]" aria-hidden="true" />
              <input
                type="search"
                value={agentQuery}
                onChange={(event) => setAgentQuery(event.target.value)}
                placeholder="Search Agent by name or email"
                aria-label="Search Agent"
                disabled={!eventId}
                className="h-9 w-full rounded border border-[#dfe1e6] bg-white pl-8 pr-2 text-sm outline-none focus:border-[#0c66e4] disabled:bg-[#f7f8fa]"
              />
            </label>
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_5rem_6rem_1fr] gap-3 border-b border-[#dfe1e1] bg-[#f7f8fa] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
              <span>Agent</span><span>Pool</span><span>Weight</span><span>Share</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {!eventId ? <p className="px-3 py-8 text-center text-sm text-[#6b778c]">Choose an Event to configure its Agents.</p> : loading ? <p className="px-3 py-8 text-center text-sm text-[#6b778c]">Loading Agents…</p> : rosterError ? <p className="px-3 py-8 text-center text-sm text-rose-700">Could not load the Agent roster.</p> : agentsByEmail.length === 0 ? <p className="px-3 py-8 text-center text-sm text-[#6b778c]">No Agents found. Add them under Account Management → Agent membership → Agents.</p> : visibleAgents.length === 0 ? <p className="px-3 py-8 text-center text-sm text-[#6b778c]">No Agent matches “{agentQuery.trim()}”.</p> : visibleAgents.map((agent) => {
                const current = draft.find((row) => row.agent_email.trim().toLowerCase() === agent.email.trim().toLowerCase());
                const active = Boolean(current?.is_active);
                const weightRow = current ?? { agent_email: agent.email, weight: 0, position: draft.length + 1, is_active: false, share: 0, current_weight: 0 };
                const label = personLabel(agent.email, nameByEmail);
                const share = shareOf(weightRow);
                return (
                  <div key={agent.email} className={`grid grid-cols-[minmax(0,1fr)_5rem_6rem_1fr] items-center gap-3 border-b border-[#ebecf0] px-3 py-2 transition hover:bg-[#f7f8f9] ${active && weightRow.weight === 0 ? "opacity-70" : ""}`}>
                    <span className="flex min-w-0 items-center gap-2">
                      <Initials email={agent.email} label={label} />
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[#172b4d]">{label}</span><span className="block truncate text-xs text-[#8993a4]">{agent.email}</span></span>
                    </span>
                    <span className="flex justify-center"><input type="checkbox" aria-label={`${label} receives ${selectedEvent?.name ?? "this Event"} leads`} checked={active} onChange={(event) => toggleAgent(agent.email, event.target.checked)} /></span>
                    <input type="number" min={0} aria-label={`Weight for ${label}`} className={INPUT_CLASS} value={weightRow.weight} disabled={!active} onChange={(event) => updateWeight(agent.email, event.target.value)} />
                    <span className="flex items-center gap-2"><span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#ebecf0]"><span className="block h-full rounded-full bg-[#0c66e4]" style={{ width: `${share}%` }} /></span><span className="w-10 shrink-0 text-right text-xs font-bold tabular-nums text-[#42526e]">{share}%</span></span>
                  </div>
                );
              })}
            </div>
          </div>

          {activeRows.length > 0 ? (
            <div className="shrink-0 rounded-lg border border-[#b8d4ff] bg-[#e9f2ff] px-3 py-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-[#0c3d91]">Next leads for this Event</span>
              <ol className="mt-2 flex items-center gap-1 overflow-x-auto pb-1">{upcoming.map((email, index) => <li key={`${email}-${index}`} title={`#${index + 1} — ${personLabel(email, nameByEmail)}`} className={`flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 ${index === 0 ? "border-[#0c66e4] bg-white shadow-sm" : "border-transparent bg-white/70"}`}><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#dfe1e6] text-[10px] font-bold text-[#42526e]">{index + 1}</span><span className="max-w-[7rem] truncate text-xs font-semibold text-[#172b4d]">{personLabel(email, nameByEmail)}</span></li>)}</ol>
              {dirty ? <p className="mt-1 text-[11px] font-semibold text-[#974f0c]">Preview only — save to make this the actual rotation.</p> : null}
            </div>
          ) : null}

          {result ? <p className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Assigned <strong>{result.assigned}</strong>{result.unassigned > 0 ? <> · left in this Event&apos;s pool <strong>{result.unassigned}</strong>{result.reason ? ` — ${result.reason}` : ""}</> : null}</p> : null}
          {notice ? <p className="shrink-0 text-sm font-semibold text-emerald-700">{notice}</p> : null}
          {error ? <p role="alert" className="shrink-0 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[#dfe1e1] px-5 py-3">
          <button type="button" onClick={() => void resetCursor()} disabled={busy || !eventId} title="Discard the part-finished rotation" className="inline-flex h-9 items-center gap-1.5 rounded px-2 text-sm font-semibold text-[#6b778c] transition hover:text-[#172b4d] disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /> Reset rotation</button>
          <div className="flex items-center gap-2">
            {blockedReason && !busy ? <span className="text-xs font-semibold text-[#974f0c]">{blockedReason}</span> : null}
            <button type="button" onClick={() => void save()} disabled={busy || loading || !dirty} className="inline-flex h-9 items-center rounded border border-[#dfe1e1] bg-white px-3 text-sm font-bold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:opacity-40">Save Event pool</button>
            <button type="button" onClick={() => void saveThenDistribute()} disabled={Boolean(blockedReason) || busy} className="inline-flex h-9 items-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"><Shuffle className="h-4 w-4" />{busy ? "Working…" : dirty ? `Save and distribute ${pool?.pending ?? 0}` : `Distribute ${pool?.pending ?? 0}`}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** Không phân biệt hoa thường và dấu: "huyen" khớp "Huyền". */
function foldSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
}

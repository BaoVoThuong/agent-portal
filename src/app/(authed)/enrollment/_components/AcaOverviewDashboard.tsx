"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, RefreshCw } from "lucide-react";
import { ACA_OVERVIEW_THRESHOLD_DAYS, type AcaOverviewPerson, type AcaOverviewSnapshot, type AcaOverviewThresholdDays } from "@/lib/enrollment/aca-overview-types";
import { applyResponsibleAssignment, reconcileAssignedRow } from "@/lib/enrollment/aca-overview-assign";
import { enrollmentStateBadgeStyle } from "@/lib/enrollment/option-badge";
import { formatEmailAsName } from "@/lib/tasks/people";
import type { EnrollmentProgram } from "@/lib/enrollment/types";
import { AvatarStack, Initials } from "../../tasks/_components/board-ui";
import { AcaAssignPicker } from "./AcaAssignPicker";
import { AcaOverviewScorecards } from "./AcaOverviewScorecards";

type Props = { program: EnrollmentProgram; from: string; to: string; onOpenRecord: (id: string) => void };

export function AcaOverviewDashboard({ program, from, to, onOpenRecord }: Props) {
  const programLabel = program === "aca" ? "ACA" : "Medicare";
  const [snapshot, setSnapshot] = useState<AcaOverviewSnapshot | null>(null);
  const [matrixMode, setMatrixMode] = useState<"occupancy" | "speed">("occupancy");
  const [threshold, setThreshold] = useState<AcaOverviewThresholdDays | null>(null);
  const [editingQueue, setEditingQueue] = useState(false);
  const [updatingQueueEmail, setUpdatingQueueEmail] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current; setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      params.set("program", program);
      if (threshold !== null) params.set("thresholdDays", String(threshold));
      if (from) params.set("from", from); if (to) params.set("to", to);
      const response = await fetch(`/api/enrollment/aca-overview?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as AcaOverviewSnapshot | { error?: string } | null;
      if (!response.ok) throw new Error(payload && "error" in payload ? payload.error : `Could not load ${programLabel} overview.`);
      if (current === sequence.current) setSnapshot(payload as AcaOverviewSnapshot);
    } catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : `Could not load ${programLabel} overview.`); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [from, program, programLabel, threshold, to]);
  // Fetching the snapshot is the external synchronization this effect owns.
  // The loader also updates loading/error state while handling the request.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [load]);
  // Every hook must run before the guards below. These early returns fire while
  // the first snapshot is loading, so a hook placed after them is skipped on
  // that render and called on the next one — which is exactly the "rendered
  // more hooks than during the previous render" crash.
  const handleToggleQueue = useCallback(async (email: string, enabled: boolean) => {
    setUpdatingQueueEmail(email); setQueueError(null);
    try {
      const response = await fetch("/api/enrollment/aca-overview/queue-members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, enabled, program }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not update the assignment queue.");
      await load();
    } catch (cause) {
      setQueueError(cause instanceof Error ? cause.message : "Could not update the assignment queue.");
    } finally { setUpdatingQueueEmail(null); }
  }, [load, program]);
  if (loading && !snapshot) return <Message>Loading {programLabel} operations...</Message>;
  if (error && !snapshot) return <Message error={error} onRetry={() => void load()} />;
  if (!snapshot) return <Message>No {programLabel} overview data.</Message>;
  const period = snapshot.period.from && snapshot.period.to ? `${snapshot.period.from} – ${snapshot.period.to}` : "All dates";
  const people = snapshot.people.filter((person) => person.email).map((person) => ({ email: person.email!, name: person.name, canWork: true, queueEnabled: true }));
  const handleAssigned = (recordId: string, email: string | null, updatedAt?: string) => setSnapshot((current) => {
    if (!current) return current;
    const wasUnassigned = current.unassigned.some((row) => row.recordId === recordId);
    const movedFromUnassigned = Boolean(email) && wasUnassigned;
    const movedToUnassigned = !email && !wasUnassigned;
    return {
      ...current,
      actions: reconcileAssignedRow(applyResponsibleAssignment(current.actions, recordId, email), recordId, updatedAt),
      unassigned: email ? current.unassigned.filter((row) => row.recordId !== recordId) : reconcileAssignedRow(current.unassigned, recordId, updatedAt),
      scorecards: movedFromUnassigned || movedToUnassigned
        ? { ...current.scorecards, unassigned: Math.max(0, current.scorecards.unassigned + (movedToUnassigned ? 1 : -1)) }
        : current.scorecards,
      people: current.people.map((row) => {
        if (row.kind === "person" && row.email === email) return { ...row, holding: row.holding + 1 };
        if (row.kind === "unassigned" && movedFromUnassigned) return { ...row, holding: Math.max(0, row.holding - 1) };
        if (row.kind === "unassigned" && movedToUnassigned) return { ...row, holding: row.holding + 1 };
        if (row.kind === "team" && movedFromUnassigned) return { ...row, holding: row.holding + 1 };
        if (row.kind === "team" && movedToUnassigned) return { ...row, holding: Math.max(0, row.holding - 1) };
        return row;
      }),
    };
  });
  return <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#f7f9fc]">
    <div className="mx-auto w-full max-w-[1480px] space-y-5 px-4 pb-8 pt-1 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#dbe2eb] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(22,35,58,0.04)] sm:px-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#667085]">
            <span>Attention threshold</span>
            <ThresholdSelect value={threshold ?? snapshot.thresholdDays} onChange={setThreshold} />
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#cfd8e5] bg-white px-3 text-xs font-bold text-[#344054] transition hover:border-[#0c66e4] hover:text-[#0c66e4]"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
          <p className="text-xs text-[#667085]">Created-date cohort · <span className="font-semibold text-[#344054]">{period}</span></p>
        </div>
        <p className="text-xs text-[#98a2b3]">Snapshot {new Date(snapshot.generatedAt).toLocaleString()}</p>
      </div>
      <AcaOverviewScorecards scorecards={snapshot.scorecards} thresholdDays={snapshot.thresholdDays} />
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white"><Header title="Pipeline by stage" caption="Terminal stages are excluded from live waiting percentages."/><div className="max-h-[420px] overflow-y-auto overflow-x-hidden"><table className="w-full table-fixed text-sm"><thead className="sticky top-0 z-10 whitespace-nowrap bg-[#fafbfc] text-left text-[10px] font-bold uppercase leading-4 tracking-wide text-[#6b778c]"><tr className="divide-x divide-[#e6eaf0]"><th className="w-[31%] px-3 py-3">Stage</th><th title="Number of enrollments currently in this stage" className="w-[11.5%] px-2 py-3 text-right">In stage</th><th title="Percentage of open enrollments" className="w-[11.5%] px-2 py-3 text-right">Share</th><th title="Middle value of time spent waiting" className="w-[13%] px-2 py-3 text-right">Typical wait</th><th title="Longest current wait" className="w-[13%] px-2 py-3 text-right">Longest wait</th><th title={`Enrollments beyond the ${snapshot.thresholdDays}-day attention threshold`} className="w-[10%] px-2 py-3 text-right">Over limit</th><th title={`Enrollments with no recent activity within the ${snapshot.thresholdDays}-day attention threshold`} className="w-[10%] px-2 py-3 text-right">No activity</th></tr></thead><tbody>{snapshot.stageTable.map((row) => { const stageAgeEstimated = (row.estimatedCount ?? 0) > 0; const estimatedTitle = stageAgeEstimated ? "Estimated: this record predates stage-time tracking." : undefined; const estimatedClass = stageAgeEstimated ? "text-[#8993a4] italic" : ""; return <tr key={row.stageId ?? row.stageLabel} className="divide-x divide-[#e6eaf0] border-t border-[#ebecf0]"><td className="whitespace-nowrap px-3 py-3 font-semibold text-[#42526e]"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: row.stageColor ?? "#c1c7d0" }}/>{row.stageLabel}</td><td className="whitespace-nowrap px-2 py-3 text-right font-bold">{row.inStage}</td><td className="whitespace-nowrap px-2 py-3 text-right">{row.sharePercent == null ? "—" : `${row.sharePercent.toFixed(1)}%`}</td><td title={estimatedTitle} className={`whitespace-nowrap px-2 py-3 text-right ${estimatedClass}`}>{formatDays(row.medianWaitDays)}</td><td title={estimatedTitle} className={`whitespace-nowrap px-2 py-3 text-right ${estimatedClass}`}>{formatDays(row.longestWaitDays)}</td><td className="whitespace-nowrap px-2 py-3 text-right">{row.stuckCount ?? "—"}</td><td className="whitespace-nowrap px-2 py-3 text-right">{row.silentCount ?? "—"}</td></tr>; })}</tbody></table></div></section>
    <ActionSection title="Needs action" rows={snapshot.actions} onOpenRecord={onOpenRecord} people={people} onAssigned={handleAssigned}/>
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white"><Header title="People" caption="Open enrollments currently assigned to each person or group."/><div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[820px] table-fixed text-sm"><thead className="sticky top-0 z-10 whitespace-nowrap bg-[#fafbfc] text-left text-[11px] font-bold uppercase tracking-wide text-[#6b778c]"><tr className="divide-x divide-[#e6eaf0]"><th className="w-[28%] px-4 py-3">Owner / team member</th><th title="Open enrollments currently assigned" className="w-[16%] px-4 py-3 text-right">Open enrollments</th><th title="Enrollments beyond the attention threshold" className="w-[16%] px-4 py-3 text-right">Over stage limit</th><th title="Enrollments with no recent activity" className="w-[16%] px-4 py-3 text-right">No recent activity</th><th className="w-[14%] px-4 py-3 text-right">Typical wait</th><th className="w-[10%] px-4 py-3 text-right">Completed</th></tr></thead><tbody>{snapshot.people.map((row) => <tr key={row.email ?? row.kind} className="divide-x divide-[#e6eaf0] border-t border-[#ebecf0]"><td className="whitespace-nowrap px-4 py-3 font-semibold text-[#42526e]">{row.name ?? row.email ?? "Unassigned"}</td><td className="whitespace-nowrap px-4 py-3 text-right font-bold">{row.holding}</td><td className="whitespace-nowrap px-4 py-3 text-right">{row.stuck}</td><td className="whitespace-nowrap px-4 py-3 text-right">{row.silent}</td><td className="whitespace-nowrap px-4 py-3 text-right">{formatDays(row.medianWaitDays)}</td><td className="whitespace-nowrap px-4 py-3 text-right">{row.doneInPeriod}</td></tr>)}</tbody></table></div></section>
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ebecf0] px-4 py-3"><div><h2 className="text-sm font-bold text-[#172b4d]">Owner × stage</h2><p className="mt-0.5 text-xs text-[#6b778c]">{matrixMode === "occupancy" ? "Open enrollments by owner and stage. Over stage limit means the work has waited too long." : "Typical completion time by owner and stage. Fewer than 10 completed enrollments shows —."}</p></div><div className="inline-flex rounded border border-[#cfd8e5] p-0.5 text-xs font-bold"><button type="button" onClick={() => setMatrixMode("occupancy")} className={`rounded px-2 py-1 ${matrixMode === "occupancy" ? "bg-[#e9f2ff] text-[#0c66e4]" : "text-[#6b778c]"}`}>Current workload</button><button type="button" onClick={() => setMatrixMode("speed")} className={`rounded px-2 py-1 ${matrixMode === "speed" ? "bg-[#e9f2ff] text-[#0c66e4]" : "text-[#6b778c]"}`}>Completion speed</button></div></div><div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[1700px] table-fixed text-sm"><thead className="sticky top-0 z-10 whitespace-nowrap bg-[#fafbfc] text-left text-[11px] font-bold tracking-wide text-[#6b778c]"><tr className="divide-x divide-[#e6eaf0]"><th className="sticky left-0 z-10 w-[180px] whitespace-nowrap bg-[#fafbfc] px-4 py-3">Owner / team member</th>{snapshot.matrix.stageLabels.map((label, index) => <th key={snapshot.matrix.stageIds[index] ?? `stage-${index}`} className="w-[170px] whitespace-nowrap px-4 py-3 text-right">{label}</th>)}</tr></thead><tbody>{snapshot.matrix.rows.map((row) => <tr key={row.email ?? row.name ?? "unassigned"} className="divide-x divide-[#e6eaf0] border-t border-[#ebecf0]"><td className="sticky left-0 z-10 w-[180px] whitespace-nowrap bg-white px-4 py-3 font-semibold text-[#42526e]">{row.name ?? "Unassigned"}</td>{row.cells.map((cell, index) => <td key={snapshot.matrix.stageIds[index] ?? `stage-${index}`} className="whitespace-nowrap px-4 py-3 text-right">{matrixMode === "occupancy" ? <><span className="font-bold">{cell.tasks}</span><span className="ml-1 text-xs text-[#8993a4]">({cell.stuck} over limit)</span></> : row.email ? <span className="font-bold text-[#42526e]">{snapshot.personStageTiming.cells[row.email]?.[snapshot.matrix.stageIds[index]]?.medianDays == null ? "—" : `${snapshot.personStageTiming.cells[row.email][snapshot.matrix.stageIds[index]].medianDays}d`}</span> : "—"}</td>)}</tr>)}</tbody></table></div></section>
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ebecf0] px-4 py-3"><div><h2 className="text-sm font-bold text-[#172b4d]">Assignment queue</h2><p className="mt-0.5 text-xs text-[#6b778c]">Never assigned first, then oldest assignment. Open = currently assigned; over limit = waiting too long. · {period}</p></div><button type="button" onClick={() => { setEditingQueue((value) => !value); setQueueError(null); }} className="rounded border border-[#cfd8e5] bg-white px-3 py-1.5 text-xs font-bold text-[#344054]">{editingQueue ? "Done" : "Edit queue"}</button></div>{editingQueue ? <div className="border-b border-[#ebecf0] bg-[#fbfdff] px-4 py-3">{queueError ? <p className="mb-2 rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-xs font-semibold text-[#bf2600]">{queueError}</p> : null}<div className="max-h-[420px] grid gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{snapshot.people.filter((person) => person.email).map((person) => { const email = person.email!; const enabled = snapshot.queue.some((card) => card.email === email); return <label key={email} className={`flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm font-semibold ${enabled ? "border-[#b3d4ff] bg-white text-[#172b4d]" : "border-[#dfe3ea] bg-[#f4f5f7] text-[#667085]"}`}><span className="min-w-0 truncate">{person.name ?? email}</span><input type="checkbox" checked={enabled} disabled={updatingQueueEmail === email} onChange={(event) => void handleToggleQueue(email, event.target.checked)} className="h-4 w-4 shrink-0 rounded border-[#c1c7d0] disabled:opacity-50" /></label>; })}</div></div> : null}<div className="flex gap-3 overflow-x-auto p-4 pb-5">{snapshot.queue.map((person) => <div key={person.email} className="min-w-[180px] rounded-lg border border-[#dfe1e6] bg-[#fafbfc] p-3"><p className="font-bold text-[#172b4d]">{person.name ?? person.email}</p><p className="mt-2 text-xs text-[#6b778c]">Open <b>{person.holding}</b> · Over limit <b>{person.stuck}</b></p><p className="mt-1 text-[11px] text-[#8993a4]">{person.lastAssignedAt ? `Last assigned ${new Date(person.lastAssignedAt).toLocaleDateString()}` : "Never assigned"}</p></div>)}{snapshot.queue.length === 0 ? <p className="text-sm text-[#8993a4]">Nobody is enabled in the queue.</p> : null}</div></section>
    <ActionSection title="Unassigned" rows={snapshot.unassigned} onOpenRecord={onOpenRecord} people={people} onAssigned={handleAssigned} assignable/>
    </div>
  </div>;
}
function Header({ title, caption }: { title: string; caption: string }) { return <div className="border-b border-[#ebecf0] px-4 py-3"><h2 className="text-sm font-bold text-[#172b4d]">{title}</h2><p className="mt-0.5 text-xs text-[#6b778c]">{caption}</p></div>; }
function ThresholdSelect({ value, onChange }: { value: AcaOverviewThresholdDays; onChange: (value: AcaOverviewThresholdDays) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Attention threshold"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex h-9 min-w-[7.5rem] items-center justify-between gap-3 rounded-lg border bg-white px-3 text-xs font-bold text-[#344054] shadow-sm outline-none transition ${open ? "border-[#0c66e4] ring-2 ring-[#dbeafe]" : "border-[#cfd8e5] hover:border-[#0c66e4]"}`}
      >
        <span>{value} days</span>
        <ChevronDown className={`h-4 w-4 text-[#667085] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div role="listbox" aria-label="Attention threshold options" className="absolute left-0 top-full z-40 mt-2 w-full min-w-[7.5rem] rounded-xl border border-[#dbe2eb] bg-white p-1.5 shadow-[0_12px_28px_rgba(22,35,58,0.16)]">
          {ACA_OVERVIEW_THRESHOLD_DAYS.map((option) => {
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${selected ? "bg-[#e9f2ff] text-[#0c66e4]" : "text-[#344054] hover:bg-[#f4f7fb]"}`}
              >
                <span>{option} days</span>
                {selected ? <Check className="h-4 w-4" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
function ActionSection({ title, rows, onOpenRecord, people, onAssigned, assignable = false }: { title: string; rows: AcaOverviewSnapshot["actions"]; onOpenRecord: (id: string) => void; people: readonly AcaOverviewPerson[]; onAssigned: (recordId: string, email: string | null, updatedAt?: string) => void; assignable?: boolean }) {
  const pageSize = 20;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white"><Header title={title} caption="Sorted by the longest stage wait or time since the last update."/><div className="max-h-[420px] overflow-auto">{rows.length === 0 ? <p className="px-4 py-6 text-sm text-[#8993a4]">Nothing currently matches.</p> : <table className="w-full min-w-[1080px] table-fixed text-sm"><thead className="sticky top-0 z-10 whitespace-nowrap bg-[#fafbfc] text-left text-[11px] font-bold uppercase tracking-wide text-[#6b778c]"><tr className="divide-x divide-[#e6eaf0]"><th className="sticky left-0 z-20 w-[23%] border-r border-[#ebecf0] bg-[#fafbfc] px-3 py-2.5">Client name</th><th className="w-[13%] px-3 py-2.5">Agent</th><th className="w-[18%] px-3 py-2.5">Enrollment owner</th><th className="w-[13%] px-3 py-2.5">Caller</th><th className="w-[10%] px-3 py-2.5">Created</th><th className="w-[11%] px-3 py-2.5">Last update</th><th className="w-[12%] px-3 py-2.5">Stage</th></tr></thead><tbody>{visible.map((row) => <tr key={row.recordId} className="group min-h-11 divide-x divide-[#e6eaf0] border-t border-[#ebecf0] align-middle bg-white transition hover:bg-[#f7f8f9]"><td className="sticky left-0 z-10 w-[23%] border-r border-[#dfe1e6] bg-white px-3 py-2.5 group-hover:bg-[#f7f8f9]"><button type="button" onClick={() => onOpenRecord(row.recordId)} className="block min-w-0 max-w-full truncate rounded px-1.5 py-1 text-left text-sm font-medium text-[#172b4d] transition hover:bg-[#f4f5f7] hover:text-[#0c66e4]" title={row.clientName ?? row.taskId ?? row.recordId}>{row.clientName ?? row.taskId ?? row.recordId}</button></td><td className="whitespace-nowrap px-3 py-2.5"><AcaPersonCell email={row.agentEmail} people={people} /></td><td className="px-3 py-2.5">{assignable ? <AcaAssignPicker recordId={row.recordId} expectedUpdatedAt={row.updatedAt} people={people} currentEmail={row.responsibleEmail} onAssigned={(email, updatedAt) => onAssigned(row.recordId, email, updatedAt)}/> : <AcaPersonCell email={row.responsibleEmail} people={people} />}</td><td className="px-3 py-2.5"><AcaPersonCell email={row.callerEmail} people={people} /></td><td className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-[#42526e]" title={row.createdAt}>{formatActionDate(row.createdAt)}</td><td className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-[#42526e]" title={row.lastActivityAt ?? undefined}>{formatActionDate(row.lastActivityAt)}</td><td className="px-3 py-2.5"><AcaStageCell label={row.stageLabel} color={row.stageColor} /></td></tr>)}</tbody></table>}</div>{pageCount > 1 ? <div className="flex items-center justify-between border-t border-[#ebecf0] px-3 py-2 text-xs font-semibold text-[#6b778c]"><span>Page {currentPage + 1} of {pageCount}</span><div className="flex gap-2"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded border border-[#cfd8e5] px-2 py-1 disabled:opacity-40">Previous</button><button type="button" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)} className="rounded border border-[#cfd8e5] px-2 py-1 disabled:opacity-40">Next</button></div></div> : null}</section>;
}
function Message({ children, error, onRetry }: { children?: ReactNode; error?: string; onRetry?: () => void }) { return <div className={`rounded-lg border px-4 py-5 text-sm font-semibold ${error ? "border-[#ffbdad] bg-[#ffebe6] text-[#bf2600]" : "border-[#e6eaf0] bg-white text-[#6b778c]"}`}>{error ?? children}{onRetry ? <button type="button" onClick={onRetry} className="ml-3 rounded border border-current px-2 py-1 text-xs">Retry</button> : null}</div>; }
function AcaPersonCell({ email, people }: { email: string | null; people: readonly AcaOverviewPerson[] }) { const label = displayPerson(email, people); return email ? <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#42526e]" title={label}><Initials email={email} label={label} /><span className="min-w-0 truncate">{label}</span></span> : <span className="flex min-w-0 items-center gap-1.5 text-xs text-[#97a0af]"><AvatarStack emails={[]} /><span className="truncate">Unassigned</span></span>; }
function AcaStageCell({ label, color }: { label: string | null; color: string | null }) { const displayLabel = label ?? "Unassigned"; const style = enrollmentStateBadgeStyle(color ? { color } : null); return <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-wide" style={{ backgroundColor: style.bg, color: style.fg }} title={displayLabel}><span className="min-w-0 truncate">{displayLabel}</span></span>; }
function displayPerson(email: string | null, people: readonly AcaOverviewPerson[]) { if (!email) return "Unassigned"; return people.find((person) => person.email === email)?.name?.trim() || formatEmailAsName(email); }
function formatActionDate(value: string | null | undefined) { if (!value) return "No activity"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
function formatDays(value: number | null) { return value == null ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1)}d`; }

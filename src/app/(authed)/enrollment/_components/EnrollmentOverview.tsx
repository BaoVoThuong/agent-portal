"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { rankEnrollmentRecommendation } from "@/lib/enrollment/overview";
import type {
  EnrollmentOverviewAttentionBar,
  EnrollmentOverviewRiskFlag,
  EnrollmentOverviewRow,
  EnrollmentOverviewSnapshot,
  EnrollmentOverviewStatus,
} from "@/lib/enrollment/overview-types";
import type { EnrollmentProgram } from "@/lib/enrollment/types";
import { formatEmailAsName } from "@/lib/tasks/people";
import { Initials } from "../../tasks/_components/board-ui";

const STATUS_STYLE: Record<EnrollmentOverviewStatus, { bg: string; fg: string; label: string }> = {
  free: { bg: "#e3fcef", fg: "#00875a", label: "Free" },
  ok: { bg: "#e6effd", fg: "#0c66e4", label: "OK" },
  busy: { bg: "#fff7d6", fg: "#7f5f01", label: "Busy" },
  overloaded: { bg: "#ffebe6", fg: "#bf2600", label: "Overloaded" },
};

export function EnrollmentOverview({
  program,
  onOpenRecord,
  onAssign,
}: {
  program: EnrollmentProgram;
  onOpenRecord: (id: string) => void;
  onAssign: (recordId: string, email: string) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<EnrollmentOverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusedFlag, setFocusedFlag] = useState<EnrollmentOverviewRiskFlag | null>(null);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [recommendFor, setRecommendFor] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/enrollment/overview?program=${program}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load overview.");
      setSnapshot((await response.json()) as EnrollmentOverviewSnapshot);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load overview.");
    } finally {
      setLoading(false);
    }
  }

  // Program-scoped state (snapshot/focus/expand/recommend) resets for free
  // because the call site keys this component by `program` (full remount) —
  // this effect only needs to trigger the initial fetch, not reset state.
  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      try {
        const response = await fetch(`/api/enrollment/overview?program=${program}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load overview.");
        const data = (await response.json()) as EnrollmentOverviewSnapshot;
        if (!cancelled) setSnapshot(data);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load overview.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitial();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !snapshot) {
    return (
      <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">
        Loading overview...
      </div>
    );
  }
  if (error || !snapshot) {
    return (
      <div className="rounded border border-[#ffbdad] bg-[#ffebe6] px-6 py-4 text-sm font-bold text-[#bf2600]">
        {error ?? "No data."}
      </div>
    );
  }

  const filteredRows = focusedFlag
    ? snapshot.rows.filter((row) => row.riskFlags.includes(focusedFlag))
    : snapshot.rows;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-[#6b778c]">
          Generated {new Date(snapshot.generatedAt).toLocaleTimeString()}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-[#cfd8e5] bg-white px-2.5 text-xs font-bold text-[#344054] hover:bg-[#f8fafc]"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile label="People" value={snapshot.kpis.peopleCount} />
        <MetricTile label="Free" value={snapshot.kpis.zeroLoadCount} tone="ok" />
        <MetricTile label="Open records" value={snapshot.kpis.openRecordCount} />
        <MetricTile
          label="Needs attention"
          value={snapshot.kpis.needsAttentionCount}
          tone={snapshot.kpis.needsAttentionCount > 0 ? "warning" : "default"}
        />
        <MetricTile
          label="Unassigned"
          value={snapshot.kpis.unassignedCount}
          tone={snapshot.kpis.unassignedCount > 0 ? "warning" : "default"}
        />
      </div>

      <div className="rounded-lg border border-[#e6eaf0] bg-white p-4">
        <h3 className="text-sm font-bold text-[#172b4d]">Attention areas</h3>
        <p className="mt-1 text-xs text-[#667085]">Click a bar to focus the table below on the affected people.</p>
        <div className="mt-3 space-y-2">
          {snapshot.attention.map((bar) => (
            <AttentionRow
              key={bar.key}
              bar={bar}
              active={focusedFlag === bar.key}
              onClick={() => setFocusedFlag((current) => (current === bar.key ? null : bar.key))}
            />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[#e6eaf0] bg-white p-4">
        <h3 className="text-sm font-bold text-[#172b4d]">Work mix by stage</h3>
        <p className="mt-1 text-xs text-[#667085]">
          Open records per stage, shaded by attention state.
        </p>
        <div className="mt-3 space-y-1.5">
          {snapshot.workMix.stages.map((stage) => (
            <div key={stage.stageId} className="flex items-center gap-2 text-xs">
              <span className="w-40 shrink-0 truncate font-semibold text-[#42526e]">{stage.stageLabel}</span>
              <div className="flex h-4 flex-1 overflow-hidden rounded bg-[#f4f5f7]">
                {stage.warning > 0 ? (
                  <div style={{ width: `${(stage.warning / stage.total) * 100}%`, backgroundColor: "#ffab00" }} />
                ) : null}
                {stage.ok > 0 ? (
                  <div style={{ width: `${(stage.ok / stage.total) * 100}%`, backgroundColor: "#36b37e" }} />
                ) : null}
              </div>
              <span className="w-8 shrink-0 text-right font-bold text-[#172b4d]">{stage.total}</span>
            </div>
          ))}
          {snapshot.workMix.stages.length === 0 ? (
            <p className="text-xs text-[#97a0af]">No open records.</p>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
        <div className="flex items-center justify-between border-b border-[#e6eaf0] px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-[#172b4d]">Workload</h3>
            <p className="mt-1 text-xs text-[#667085]">
              {filteredRows.length} of {snapshot.rows.length} people shown.
            </p>
          </div>
          {focusedFlag ? (
            <button
              type="button"
              onClick={() => setFocusedFlag(null)}
              className="text-xs font-bold text-[#0c66e4] hover:underline"
            >
              Clear filter
            </button>
          ) : null}
        </div>
        <ul className="divide-y divide-[#ebecf0]">
          {filteredRows.map((row) => (
            <WorkloadRow
              key={row.email}
              row={row}
              expanded={expandedEmail === row.email}
              onToggle={() => setExpandedEmail((current) => (current === row.email ? null : row.email))}
              onOpenRecord={onOpenRecord}
            />
          ))}
          {filteredRows.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[#97a0af]">Nobody matches this filter.</li>
          ) : null}
        </ul>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
        <div className="border-b border-[#e6eaf0] px-4 py-3">
          <h3 className="text-sm font-bold text-[#172b4d]">Unassigned queue</h3>
          <p className="mt-1 text-xs text-[#667085]">{snapshot.unassigned.length} record(s) waiting for an owner.</p>
        </div>
        <ul className="divide-y divide-[#ebecf0]">
          {snapshot.unassigned.map((record) => (
            <li key={record.id} className="flex items-center gap-3 px-4 py-2.5">
              <button
                type="button"
                onClick={() => onOpenRecord(record.id)}
                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[#172b4d] hover:text-[#0c66e4]"
              >
                {record.clientName || "Unnamed client"}
              </button>
              <button
                type="button"
                onClick={() => setRecommendFor((current) => (current === record.id ? null : record.id))}
                className="shrink-0 rounded border border-[#cfd8e5] bg-white px-2 py-1 text-xs font-bold text-[#344054] hover:bg-[#f8fafc]"
              >
                Recommend
              </button>
            </li>
          ))}
          {snapshot.unassigned.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[#97a0af]">Nothing unassigned.</li>
          ) : null}
        </ul>
        {recommendFor ? (
          <RecommendationPanel
            snapshot={snapshot}
            recordId={recommendFor}
            onAssign={async (email) => {
              await onAssign(recommendFor, email);
              setRecommendFor(null);
              void load();
            }}
            onClose={() => setRecommendFor(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "ok" | "warning" | "danger";
}) {
  const toneClass = {
    default: "text-[#172b4d]",
    ok: "text-[#00875a]",
    warning: "text-[#b76e00]",
    danger: "text-[#bf2600]",
  }[tone];
  return (
    <div className="rounded-lg border border-[#e6eaf0] bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#8993a4]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function AttentionRow({
  bar,
  active,
  onClick,
}: {
  bar: EnrollmentOverviewAttentionBar;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition ${
        active ? "bg-[#deebff]" : "hover:bg-[#f7f8fa]"
      }`}
    >
      <span className="w-28 shrink-0 text-xs font-semibold text-[#42526e]">{bar.label}</span>
      <span className="text-xs text-[#6b778c]">
        {bar.recordCount} record(s) &middot; {bar.affectedPeopleCount} people
      </span>
    </button>
  );
}

function WorkloadRow({
  row,
  expanded,
  onToggle,
  onOpenRecord,
}: {
  row: EnrollmentOverviewRow;
  expanded: boolean;
  onToggle: () => void;
  onOpenRecord: (id: string) => void;
}) {
  const style = STATUS_STYLE[row.status];
  const label = row.name?.trim() || formatEmailAsName(row.email);
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f7f8f9]"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[#6b778c]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[#6b778c]" />
        )}
        <Initials email={row.email} label={label} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#172b4d]">{label}</span>
        <span
          className="rounded px-2 py-0.5 text-[11px] font-bold uppercase"
          style={{ backgroundColor: style.bg, color: style.fg }}
        >
          {style.label}
        </span>
        <span className="w-16 shrink-0 text-right text-sm font-bold text-[#172b4d]">{row.openCount} open</span>
        {row.qcStaleCount > 0 ? (
          <span className="shrink-0 text-xs font-bold text-[#7f5f01]">{row.qcStaleCount} QC stale</span>
        ) : null}
      </button>
      {expanded ? (
        <ul className="space-y-1 bg-[#fafbfc] px-4 py-2 pl-11">
          {row.records.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => onOpenRecord(record.id)}
                className="text-xs font-medium text-[#42526e] hover:text-[#0c66e4]"
              >
                {record.clientName || "Unnamed client"}
              </button>
            </li>
          ))}
          {row.records.length === 0 ? <li className="text-xs text-[#97a0af]">No open records.</li> : null}
        </ul>
      ) : null}
    </li>
  );
}

function RecommendationPanel({
  snapshot,
  recordId,
  onAssign,
  onClose,
}: {
  snapshot: EnrollmentOverviewSnapshot;
  recordId: string;
  onAssign: (email: string) => Promise<void>;
  onClose: () => void;
}) {
  const [assigning, setAssigning] = useState<string | null>(null);
  const candidates = rankEnrollmentRecommendation(snapshot, recordId);

  return (
    <div className="border-t border-[#e6eaf0] bg-[#f7f8fa] p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wide text-[#8993a4]">Who has room?</h4>
        <button type="button" onClick={onClose} className="text-xs font-bold text-[#6b778c] hover:underline">
          Close
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {candidates.slice(0, 5).map((candidate) => (
          <li
            key={candidate.email}
            className="flex items-center justify-between gap-3 rounded border border-[#e6eaf0] bg-white px-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#172b4d]">
              {candidate.hasRiskFlag ? (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ffab00]" />
              ) : (
                <Check className="h-3.5 w-3.5 shrink-0 text-[#00875a]" />
              )}
              <span className="truncate">{candidate.name?.trim() || formatEmailAsName(candidate.email)}</span>
            </span>
            <span className="shrink-0 text-xs text-[#6b778c]">
              {candidate.openCount} &rarr; {candidate.projectedOpenCount}
            </span>
            <button
              type="button"
              disabled={assigning === candidate.email}
              onClick={async () => {
                setAssigning(candidate.email);
                await onAssign(candidate.email);
                setAssigning(null);
              }}
              className="shrink-0 rounded bg-[#0c66e4] px-2 py-1 text-xs font-bold text-white hover:bg-[#0055cc] disabled:opacity-50"
            >
              Assign
            </button>
          </li>
        ))}
        {candidates.length === 0 ? <li className="text-xs text-[#97a0af]">No one in the pool.</li> : null}
      </ul>
    </div>
  );
}

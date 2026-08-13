"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ChevronDown, RefreshCw } from "lucide-react";
import type {
  EnrollmentOverviewCycleMetric,
  EnrollmentOverviewMissingItem,
  EnrollmentOverviewNeed,
  EnrollmentOverviewRecordSummary,
  EnrollmentOverviewSnapshot,
  EnrollmentOverviewWeeklyPoint,
  EnrollmentOverviewStageDwellMetric,
} from "@/lib/enrollment/overview-types";
import type { EnrollmentProgram } from "@/lib/enrollment/types";
import { AcaOverviewDashboard } from "./AcaOverviewDashboard";

type OverviewProps = {
  program: EnrollmentProgram;
  from: string;
  to: string;
  isManager: boolean;
  onOpenRecord: (id: string) => void;
};

export function EnrollmentOverview(props: OverviewProps) {
  if (props.program === "aca") {
    if (!props.isManager) {
      return <div className="rounded-lg border border-[#dfe1e6] bg-white px-4 py-5 text-sm font-semibold text-[#6b778c]">ACA operations overview is available to managers only.</div>;
    }
    return <AcaOverviewDashboard from={props.from} to={props.to} onOpenRecord={props.onOpenRecord} />;
  }
  return <LegacyEnrollmentOverview {...props} />;
}

function LegacyEnrollmentOverview({ program, from, to, onOpenRecord }: OverviewProps) {
  const [snapshot, setSnapshot] = useState<EnrollmentOverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequenceRef.current;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ program, from, to });
      const response = await fetch(`/api/enrollment/overview?${query.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | EnrollmentOverviewSnapshot
        | { error?: string }
        | null;
      if (!response.ok) throw new Error(payload && "error" in payload ? payload.error : "Could not load overview.");
      if (sequence !== requestSequenceRef.current) return;
      setSnapshot(payload as EnrollmentOverviewSnapshot);
    } catch (loadError) {
      if (sequence !== requestSequenceRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load overview.");
    } finally {
      if (sequence === requestSequenceRef.current) setLoading(false);
    }
  }, [from, program, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading && !snapshot) {
    return <OverviewMessage>Loading enrollment operations...</OverviewMessage>;
  }
  if (error || !snapshot) {
    return (
      <div className="rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-4 py-4 text-sm font-bold text-[#bf2600]">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error ?? "No overview data."}</span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded border border-[#bf2600]/30 bg-white px-3 py-1.5 text-xs font-bold text-[#bf2600] hover:bg-[#fff5f2]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-[#6b778c]">
          Snapshot as of {new Date(snapshot.generatedAt).toLocaleString()}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-[#cfd8e5] bg-white px-2.5 text-xs font-bold text-[#344054] hover:bg-[#f8fafc]"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {program === "aca" ? (
        <AcaEnrollmentDashboard snapshot={snapshot} onOpenRecord={onOpenRecord} />
      ) : (
        <MedicareEnrollmentDashboard snapshot={snapshot} onOpenRecord={onOpenRecord} />
      )}
    </div>
  );
}

function AcaEnrollmentDashboard({
  snapshot,
  onOpenRecord,
}: {
  snapshot: EnrollmentOverviewSnapshot;
  onOpenRecord: (id: string) => void;
}) {
  return (
    <>
      <SnapshotStrip snapshot={snapshot} />
      <FunnelSection snapshot={snapshot} onOpenRecord={onOpenRecord} />
      <FlowSection weekly={snapshot.weekly} cycleTime={snapshot.cycleTime} />
      <StageDwellSection metrics={snapshot.stageDwell} />
      <NeedsCareSection needs={snapshot.needsCare} onOpenRecord={onOpenRecord} />
      <InformationQualitySection snapshot={snapshot} />
      <OutcomeSection snapshot={snapshot} />
    </>
  );
}

function MedicareEnrollmentDashboard({
  snapshot,
  onOpenRecord,
}: {
  snapshot: EnrollmentOverviewSnapshot;
  onOpenRecord: (id: string) => void;
}) {
  return (
    <>
      <SnapshotStrip snapshot={snapshot} />
      <FunnelSection snapshot={snapshot} onOpenRecord={onOpenRecord} />
      <FlowSection weekly={snapshot.weekly} cycleTime={snapshot.cycleTime} />
      <StageDwellSection metrics={snapshot.stageDwell} />
      <NeedsCareSection needs={snapshot.needsCare} onOpenRecord={onOpenRecord} />
      <InformationQualitySection snapshot={snapshot} />
    </>
  );
}

function SnapshotStrip({ snapshot }: { snapshot: EnrollmentOverviewSnapshot }) {
  const periodLabel = formatPeriod(snapshot.period.from, snapshot.period.to);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <MetricGroup title="Snapshot · now">
        <MetricTile label="Open" value={snapshot.kpis.openCount} />
        <MetricTile label="Needs care" value={snapshot.kpis.needsCareCount} tone={snapshot.kpis.needsCareCount ? "warning" : "ok"} />
        <MetricTile label="Overdue" value={snapshot.kpis.overdueCount} tone={snapshot.kpis.overdueCount ? "danger" : "ok"} />
      </MetricGroup>
      <MetricGroup title={`Period · ${periodLabel}`}>
        <MetricTile label="New" value={snapshot.kpis.newCount} />
        <MetricTile label="Closed" value={snapshot.kpis.closedCount} tone="ok" />
        <MetricTile
          label="Net change"
          value={snapshot.kpis.netChange}
          tone={snapshot.kpis.netChange > 0 ? "warning" : snapshot.kpis.netChange < 0 ? "ok" : "default"}
        />
      </MetricGroup>
    </div>
  );
}

function MetricGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#e6eaf0] bg-white p-3">
      <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">{title}</h2>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </section>
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
  const valueClass = {
    default: "text-[#172b4d]",
    ok: "text-[#00875a]",
    warning: "text-[#b76e00]",
    danger: "text-[#bf2600]",
  }[tone];
  return (
    <div className="rounded border border-[#ebecf0] bg-[#fafbfc] px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#8993a4]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

function FunnelSection({
  snapshot,
  onOpenRecord,
}: {
  snapshot: EnrollmentOverviewSnapshot;
  onOpenRecord: (id: string) => void;
}) {
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const stageNeeds = selectedStage
    ? snapshot.openRecords.filter((record) => record.stageId === selectedStage)
    : [];
  return (
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
      <SectionHeader title="Pipeline health" description="Open records by stage. Select a stage to inspect its current records." />
      <div className="grid grid-cols-[minmax(11rem,1fr)_6rem] border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
        <span>Stage</span><span className="text-right">Open</span>
      </div>
      <div className="divide-y divide-[#ebecf0]">
        {snapshot.funnel.map((stage) => (
          <button
            key={stage.stageId}
            type="button"
            onClick={() => setSelectedStage((current) => (current === stage.stageId ? null : stage.stageId))}
            className={`grid w-full grid-cols-[minmax(11rem,1fr)_6rem] items-center px-4 py-2.5 text-left text-sm transition ${selectedStage === stage.stageId ? "bg-[#edf4ff]" : "hover:bg-[#fafbfc]"}`}
          >
            <span className="flex min-w-0 items-center gap-2 font-semibold text-[#172b4d]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: stage.stageColor ?? "#c1c7d0" }} />
              <span className="truncate">{stage.stageLabel}</span>
            </span>
            <span className="text-right font-bold text-[#172b4d]">{stage.openCount}</span>
          </button>
        ))}
      </div>
      {selectedStage ? (
        <div className="border-t border-[#dfe1e6] bg-[#fafbfc] px-4 py-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#6b778c]">Records in selected stage</p>
          <RecordButtons records={stageNeeds} onOpenRecord={onOpenRecord} emptyLabel="No open records in this stage." />
        </div>
      ) : null}
    </section>
  );
}

function FlowSection({ weekly, cycleTime }: { weekly: EnrollmentOverviewWeeklyPoint[]; cycleTime: EnrollmentOverviewCycleMetric[] }) {
  const max = Math.max(1, ...weekly.flatMap((point) => [point.newCount, point.closedCount]));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,1fr)]">
      <section className="rounded-lg border border-[#e6eaf0] bg-white p-4">
        <SectionHeader title="In vs out" description="Weekly new and closed records for the selected period." />
        <div className="mt-4 space-y-2">
          {weekly.map((point) => (
            <div key={point.weekStart} className="grid grid-cols-[4rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs">
              <span className="font-semibold text-[#6b778c]">{point.label}</span>
              <div className="flex h-5 gap-1">
                <div className="rounded bg-[#0c66e4]" style={{ width: `${Math.max(point.newCount ? 5 : 0, (point.newCount / max) * 50)}%` }} title={`${point.newCount} new`} />
                <div className="rounded bg-[#36b37e]" style={{ width: `${Math.max(point.closedCount ? 5 : 0, (point.closedCount / max) * 50)}%` }} title={`${point.closedCount} closed`} />
              </div>
              <span className="text-right font-bold text-[#172b4d]">{point.newCount + point.closedCount}</span>
            </div>
          ))}
          {weekly.length === 0 ? <p className="text-sm text-[#97a0af]">No period activity.</p> : null}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] font-semibold text-[#6b778c]">
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded bg-[#0c66e4]" />New</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded bg-[#36b37e]" />Closed</span>
        </div>
      </section>
      <section className="rounded-lg border border-[#e6eaf0] bg-white p-4">
        <SectionHeader title="Cycle time" description="Median and p90 days from creation to close." />
        <div className="mt-3 divide-y divide-[#ebecf0]">
          {cycleTime.map((metric) => (
            <div key={metric.stageId ?? metric.stageLabel} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate font-semibold text-[#42526e]">{metric.stageLabel}</span>
              <span className="shrink-0 text-xs font-bold text-[#172b4d]">{formatDays(metric.medianDays)} med · {formatDays(metric.p90Days)} p90</span>
            </div>
          ))}
          {cycleTime.length === 0 ? <p className="py-2 text-sm text-[#97a0af]">No records closed in this period.</p> : null}
        </div>
      </section>
    </div>
  );
}

function StageDwellSection({ metrics }: { metrics: EnrollmentOverviewStageDwellMetric[] }) {
  return (
    <section className="rounded-lg border border-[#e6eaf0] bg-white p-4">
      <SectionHeader title="Time in stage" description="Live completed-stage dwell over the last 90 days. Backfilled history is excluded." />
      <div className="mt-3 divide-y divide-[#ebecf0]">
        {metrics.map((metric) => (
          <div key={metric.stageId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 font-semibold text-[#42526e]"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: metric.stageColor ?? "#c1c7d0" }} /><span className="truncate">{metric.stageLabel}</span></span>
            <span className="text-right text-xs font-bold text-[#172b4d]">{metric.sampleSize < 10 ? "Not enough samples" : `${formatSeconds(metric.medianSeconds)} med · ${formatSeconds(metric.p75Seconds)} p75`}</span>
          </div>
        ))}
        {metrics.length === 0 ? <p className="py-2 text-sm text-[#97a0af]">No completed live stage cycles in the last 90 days.</p> : null}
      </div>
    </section>
  );
}

function NeedsCareSection({ needs, onOpenRecord }: { needs: EnrollmentOverviewNeed[]; onOpenRecord: (id: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
      <SectionHeader title="Needs care today" description="Each count drills through to the records that need attention." />
      <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {needs.map((need) => {
          const isExpanded = expanded === need.key;
          return (
            <div key={need.key} className="rounded border border-[#ebecf0] bg-[#fafbfc]">
              <button
                type="button"
                onClick={() => setExpanded((current) => (current === need.key ? null : need.key))}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[#f4f6f9]"
              >
                <span className="min-w-0 truncate text-sm font-semibold text-[#42526e]">{need.label}</span>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${need.count ? "bg-[#fff0b3] text-[#7f5f01]" : "bg-[#e3fcef] text-[#006644]"}`}>{need.count}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-[#6b778c] transition ${isExpanded ? "rotate-180" : ""}`} />
              </button>
              {isExpanded ? <div className="border-t border-[#ebecf0] px-3 py-2"><RecordButtons records={need.records} onOpenRecord={onOpenRecord} emptyLabel="Nothing currently matches." /></div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InformationQualitySection({ snapshot }: { snapshot: EnrollmentOverviewSnapshot }) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="rounded-lg border border-[#e6eaf0] bg-white p-4">
        <SectionHeader title="Most-missing information" description="Open records, ranked by the information still missing." />
        <div className="mt-3 divide-y divide-[#ebecf0]">
          {snapshot.missingItems.map((item) => <MissingItemRow key={item.key} item={item} />)}
          {snapshot.missingItems.length === 0 ? <p className="text-sm text-[#97a0af]">No collectable fields configured.</p> : null}
        </div>
      </div>
      <div className="rounded-lg border border-[#e6eaf0] bg-white p-4">
        <SectionHeader title="Average completeness" description="Applicable fields filled across open records." />
        <div className="mt-5 text-center">
          <p className="text-4xl font-bold text-[#172b4d]">{snapshot.completeness.percentage === null ? "—" : `${snapshot.completeness.percentage}%`}</p>
          <p className="mt-2 text-xs font-semibold text-[#6b778c]">{snapshot.completeness.filledCount} / {snapshot.completeness.applicableCount} fields filled</p>
        </div>
      </div>
    </section>
  );
}

function MissingItemRow({ item }: { item: EnrollmentOverviewMissingItem }) {
  const ratio = item.applicableCount === 0 ? 0 : item.missingCount / item.applicableCount;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_6rem_8rem] items-center gap-3 py-2 text-sm">
      <span className="truncate font-semibold text-[#42526e]">{item.label}</span>
      <span className="text-right text-xs font-bold text-[#172b4d]">{item.missingCount}</span>
      <div className="h-2 overflow-hidden rounded bg-[#ebecf0]"><div className="h-full rounded bg-[#ffab00]" style={{ width: `${ratio * 100}%` }} /></div>
    </div>
  );
}

function OutcomeSection({ snapshot }: { snapshot: EnrollmentOverviewSnapshot }) {
  if (!snapshot.outcome) return null;
  const outcome = snapshot.outcome;
  return (
    <section className="rounded-lg border border-[#e6eaf0] bg-white p-4">
      <SectionHeader title="Outcome of closed records" description={`Closed during ${formatPeriod(snapshot.period.from, snapshot.period.to)}.`} />
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <OutcomeTile label="Done" value={outcome.successCount} tone="ok" />
        <OutcomeTile label="Terminated" value={outcome.lostCount} tone="danger" />
        <OutcomeTile label="Total closed" value={outcome.closedCount} />
      </div>
    </section>
  );
}

function OutcomeTile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "ok" | "danger" }) {
  return <div className="rounded border border-[#ebecf0] bg-[#fafbfc] px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-[#8993a4]">{label}</p><p className={`mt-1 text-2xl font-bold ${tone === "ok" ? "text-[#00875a]" : tone === "danger" ? "text-[#bf2600]" : "text-[#172b4d]"}`}>{value}</p></div>;
}

function RecordButtons({ records, onOpenRecord, emptyLabel }: { records: EnrollmentOverviewRecordSummary[]; onOpenRecord: (id: string) => void; emptyLabel: string }) {
  if (records.length === 0) return <p className="text-xs font-medium text-[#97a0af]">{emptyLabel}</p>;
  return (
    <div className="max-h-56 space-y-1 overflow-auto">
      {records.map((record) => (
        <button key={record.id} type="button" onClick={() => onOpenRecord(record.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[#e9f2ff]">
          <span className="min-w-0 flex-1 truncate font-semibold text-[#172b4d]">{record.clientName || "Unnamed client"}</span>
          <span className="shrink-0 text-[11px] text-[#6b778c]">{record.stageLabel ?? "No stage"}</span>
        </button>
      ))}
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-sm font-bold text-[#172b4d]">{title}</h2><p className="mt-1 text-xs text-[#667085]">{description}</p></div>;
}

function OverviewMessage({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">{children}</div>;
}

function formatDays(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 10) / 10}d`;
}

function formatSeconds(value: number | null): string {
  if (value === null) return "—";
  const hours = value / 3600;
  return hours >= 24 ? `${Math.round((hours / 24) * 10) / 10}d` : `${Math.round(hours * 10) / 10}h`;
}

function formatPeriod(from: string, to: string): string {
  if (!from && !to) return "All dates";
  const format = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00.000Z`));
  if (from === to) return format(from);
  return `${format(from)} – ${format(to)}`;
}

import type { ReactNode } from "react";
import type { AcaOverviewSnapshot } from "@/lib/enrollment/aca-overview-types";

type Tone = "default" | "good" | "warning" | "danger" | "accent";

const TONE_CLASS: Record<Tone, string> = {
  default: "text-[#172b4d]",
  good: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-rose-700",
  accent: "text-[#0c66e4]",
};

type ScorecardTileProps = {
  label: string;
  value: string | number;
  detail?: string;
  tone?: Tone;
};

function ScorecardTile({ label, value, detail, tone = "default" }: ScorecardTileProps) {
  return (
    <div className="min-w-0 border-r border-[#e6eaf0] px-4 py-3 last:border-r-0 sm:px-5">
      <div className="line-clamp-2 min-h-[2rem] text-[11px] font-bold uppercase leading-4 tracking-[0.06em] text-[#667085]">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold leading-none ${TONE_CLASS[tone]}`}>{value}</div>
      {detail ? <div className="mt-1 line-clamp-2 text-xs text-[#667085]">{detail}</div> : null}
    </div>
  );
}

function ScorecardGroup({
  title,
  description,
  children,
  columns,
}: {
  title: string;
  description: string;
  children: ReactNode;
  columns: string;
}) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden border border-[#dbe2eb] bg-white shadow-[0_1px_2px_rgba(22,35,58,0.04)]"
    >
      <div className="border-b border-[#e6eaf0] px-4 py-4 sm:px-5">
        <h2 className="text-sm font-bold text-[#172b4d]">{title}</h2>
        <p className="mt-1 text-xs text-[#667085]">{description}</p>
      </div>
      <div className={`grid ${columns}`}>{children}</div>
    </section>
  );
}

function AttentionTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="border-b border-r border-[#e6eaf0] px-4 py-4 sm:px-5 xl:border-b-0">
      <div className="text-[11px] font-bold uppercase leading-4 tracking-[0.06em] text-[#667085]">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-none ${value ? "text-rose-700" : "text-emerald-700"}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-[#667085]">{detail}</div>
    </div>
  );
}

export function AcaOverviewScorecards({
  scorecards,
  thresholdDays,
}: {
  scorecards: AcaOverviewSnapshot["scorecards"];
  thresholdDays: number;
}) {
  const formatDays = (value: number | null) =>
    value == null ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1)}d`;
  const formatMeasuredDays = (value: number | null) =>
    value == null ? "Not enough samples" : formatDays(value);
  return (
    <div className="space-y-4">
      <section
        aria-label="Enrollment totals"
        className="overflow-hidden border border-[#dbe2eb] bg-white px-4 py-1 shadow-[0_1px_2px_rgba(22,35,58,0.04)] sm:px-5"
      >
        <div className="grid grid-cols-2 divide-x divide-[#e6eaf0] sm:grid-cols-3 xl:grid-cols-6">
          <ScorecardTile label="Total enrollments" value={scorecards.totalTasks} detail="Active records in cohort" />
          <ScorecardTile label="Open enrollments" value={scorecards.open} detail="Not in a terminal stage" />
          <ScorecardTile label="Completed enrollments" value={scorecards.done} detail="Reached ID card done" tone="good" />
          <ScorecardTile label="ID card unavailable" value={scorecards.cannotGetIdCard} detail="Blocked at this outcome" tone="danger" />
          <ScorecardTile label="Terminated enrollments" value={scorecards.terminated} detail="Reached terminated stage" tone="danger" />
          <ScorecardTile label="Unassigned owner" value={scorecards.unassigned} detail="Open without Responsible Enroll" tone={scorecards.unassigned ? "accent" : "good"} />
        </div>
      </section>

      <ScorecardGroup
        title="Attention signals"
        description="Counts that tell a manager where enrollment work needs review first."
        columns="grid-cols-2 xl:grid-cols-6"
      >
        <AttentionTile label={`No recent activity ≥ ${thresholdDays}d`} value={scorecards.noActivity} detail="No work activity" />
        <AttentionTile label={`Stuck in stage ≥ ${thresholdDays}d`} value={scorecards.stuckInStage} detail="Stage age threshold" />
        <AttentionTile label="Awaiting QC review" value={scorecards.qcPending} detail="Quality review is not complete" />
        <AttentionTile label="Past due" value={scorecards.overdue} detail="Due date has passed" />
        <AttentionTile label="Unable to contact" value={scorecards.cantContact} detail="No route forward" />
      </ScorecardGroup>

      <ScorecardGroup
        title="Flow and capacity"
        description="Time and ownership metrics for understanding throughput and current team load."
        columns="grid-cols-2 xl:grid-cols-5"
      >
        <ScorecardTile label="Median time to completion" value={formatMeasuredDays(scorecards.medianTimeToDoneDays)} detail="Created → ID card done" />
        <ScorecardTile
          label="Slowest current stage"
          value={scorecards.slowestStage ? formatDays(scorecards.slowestStage.medianDays) : "Not enough samples"}
          detail={scorecards.slowestStage?.stageLabel ?? "No measured stage"}
        />
        <ScorecardTile label="Median time in current stage" value={formatDays(scorecards.medianTimeInCurrentStageDays)} detail="Open enrollments" />
        <ScorecardTile label="Median age of open enrollments" value={formatDays(scorecards.medianOpenAgeDays)} detail="Since enrollment created" />
        <ScorecardTile label="Active team members" value={scorecards.activePeople} detail="Holding at least one enrollment" />
        <ScorecardTile
          label="Average open enrollments per owner"
          value={scorecards.avgTasksPerPerson == null ? "—" : scorecards.avgTasksPerPerson.toFixed(1)}
          detail="Assigned open ÷ active owners"
        />
      </ScorecardGroup>
    </div>
  );
}

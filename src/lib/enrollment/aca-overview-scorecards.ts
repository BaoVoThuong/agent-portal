import { isDashboardTerminal } from "./aca-overview-stages";
import { daysInStage, daysSilent, isSilent, isStuck, medianDays } from "./aca-overview-timing";
import { MIN_DURATION_SAMPLE } from "./stage-time";
import type { AcaOverviewInput, AcaOverviewRecord, AcaOverviewScorecards } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";
const labelMatches = (stage: EnrollmentOption | undefined, label: string) => (stage?.label ?? "").trim().toLowerCase() === label;
const ageDays = (from: string, to: Date) => { const t = new Date(from).getTime(); return Number.isFinite(t) ? Math.max(0, Math.floor((to.getTime() - t) / 86_400_000)) : null; };
export function buildScorecards(input: AcaOverviewInput): AcaOverviewScorecards {
  const byId = new Map(input.stages.map((s) => [s.id, s]));
  const active = input.records.filter((r) => !r.archived_at);
  const stageOf = (r: AcaOverviewRecord) => r.stage_id ? byId.get(r.stage_id) : undefined;
  const done = active.filter((r) => labelMatches(stageOf(r), "10-done"));
  const terminated = active.filter((r) => labelMatches(stageOf(r), "11-terminated"));
  const terminalIds = new Set([...done, ...terminated].map((r) => r.id));
  const open = active.filter((r) => !terminalIds.has(r.id));
  const countable = open.filter((r) => !stageOf(r) || !isDashboardTerminal(stageOf(r)!));
  const holders = new Set(open.map((r) => r.responsible_enroll_email).filter(Boolean));
  const timeToDone = done.map((r) => r.closed_at ? ageDays(r.created_at, new Date(r.closed_at)) : null);
  let slowestStage: AcaOverviewScorecards["slowestStage"] = null;
  for (const [stageId, seconds] of input.stageDwellMedianSeconds) {
    if (seconds === null) continue;
    const days = seconds / 86_400;
    if (!slowestStage || days > slowestStage.medianDays) slowestStage = { stageId, stageLabel: byId.get(stageId)?.label ?? "Archived stage", medianDays: Math.round(days * 10) / 10 };
  }
  return {
    totalTasks: active.length, done: done.length, open: open.length, terminated: terminated.length,
    unassigned: open.filter((r) => !r.responsible_enroll_email).length,
    noActivity: countable.filter((r) => isSilent(daysSilent(r, input.now), input.thresholdDays)).length,
    stuckInStage: countable.filter((r) => isStuck(daysInStage(r, input.now), input.thresholdDays)).length,
    cantContact: open.filter((r) => labelMatches(stageOf(r), "can't contact")).length,
    cannotGetIdCard: open.filter((r) => labelMatches(stageOf(r), "can not get id card")).length,
    medianOpenAgeDays: medianDays(open.map((r) => ageDays(r.created_at, input.now))),
    medianTimeToDoneDays: timeToDone.filter((v) => v !== null).length >= MIN_DURATION_SAMPLE ? medianDays(timeToDone) : null,
    slowestStage,
    medianTimeInCurrentStageDays: medianDays(countable.map((r) => daysInStage(r, input.now))),
    activePeople: holders.size,
    avgTasksPerPerson: holders.size ? open.length / holders.size : null,
  };
}

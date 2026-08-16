import { isTerminalStage } from "./aca-overview-stages";
import { daysInStage, daysSilent, isSilent, isStuck, medianDays } from "./aca-overview-timing";
import { MIN_DURATION_SAMPLE } from "./stage-time";
import { enrollmentIsOverdue } from "./helpers";
import type { AcaOverviewInput, AcaOverviewRecord, AcaOverviewScorecards } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";
const labelMatches = (stage: EnrollmentOption | undefined, label: string) => (stage?.label ?? "").trim().toLowerCase() === label;
const DONE_STAGE_LABEL = "10-id card done";
const TERMINATED_STAGE_LABEL = "12-terminated";
const UNAVAILABLE_STAGE_LABEL = "11-id card unavailable";
const ageDays = (from: string, to: Date) => { const t = new Date(from).getTime(); return Number.isFinite(t) ? Math.max(0, Math.floor((to.getTime() - t) / 86_400_000)) : null; };
export function buildScorecards(input: AcaOverviewInput): AcaOverviewScorecards {
  const byId = new Map(input.stages.map((s) => [s.id, s]));
  const active = input.records.filter((r) => !r.archived_at);
  const stageOf = (r: AcaOverviewRecord) => r.stage_id ? byId.get(r.stage_id) : undefined;
  const done = active.filter((r) => labelMatches(stageOf(r), DONE_STAGE_LABEL));
  const unavailable = active.filter((r) => labelMatches(stageOf(r), UNAVAILABLE_STAGE_LABEL));
  const terminated = active.filter((r) => labelMatches(stageOf(r), TERMINATED_STAGE_LABEL));
  // The ACA stage configuration is the source of truth for whether work is
  // still open. Keep all configured Final Stages out of Open, while the three
  // ACA outcome cards below remain split by their exact stage labels.
  const terminalIds = new Set(active.filter((r) => {
    const stage = stageOf(r);
    return Boolean(stage && stage.is_terminal);
  }).map((r) => r.id));
  const open = active.filter((r) => !terminalIds.has(r.id));
  const countable = open.filter((r) => !stageOf(r) || !isTerminalStage(stageOf(r)!));
  const assignedOpen = open.filter((r) => Boolean(r.responsible_enroll_email));
  const holders = new Set(assignedOpen.map((r) => r.responsible_enroll_email));
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
    qcPending: open.filter((r) => Boolean(stageOf(r)?.triggers_qc && !r.qc_checked_at)).length,
    overdue: open.filter((r) => enrollmentIsOverdue(r, input.now)).length,
    cantContact: open.filter((r) => labelMatches(stageOf(r), "can't contact")).length,
    cannotGetIdCard: unavailable.length,
    medianOpenAgeDays: medianDays(open.map((r) => ageDays(r.created_at, input.now))),
    medianTimeToDoneDays: timeToDone.filter((v) => v !== null).length >= MIN_DURATION_SAMPLE ? medianDays(timeToDone) : null,
    slowestStage,
    medianTimeInCurrentStageDays: medianDays(countable.map((r) => daysInStage(r, input.now))),
    activePeople: holders.size,
    // Assigned open records only. Dividing total open work by the number of
    // people holding work counted the unassigned queue against people who are
    // not holding it, inflating every person's apparent load.
    avgTasksPerPerson: holders.size ? assignedOpen.length / holders.size : null,
  };
}

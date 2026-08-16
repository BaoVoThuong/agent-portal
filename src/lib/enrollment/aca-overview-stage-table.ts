import { isTerminalStage, orderStages } from "./aca-overview-stages";
import { daysInStage, daysSilent, isEstimatedStageAge, isSilent, isStuck, medianDays } from "./aca-overview-timing";
import type { AcaOverviewInput, AcaOverviewRecord, AcaOverviewStageRow } from "./aca-overview-types";
export const UNASSIGNED_STAGE_LABEL = "0-Unassigned";
function waits(records: readonly AcaOverviewRecord[], input: AcaOverviewInput) {
  const days = records.map((r) => daysInStage(r, input.now));
  return { medianWaitDays: medianDays(days), longestWaitDays: days.reduce<number | null>((m, d) => d === null ? m : Math.max(m ?? 0, d), null), stuckCount: days.filter((d) => isStuck(d, input.thresholdDays)).length, silentCount: records.filter((r) => isSilent(daysSilent(r, input.now), input.thresholdDays)).length, estimatedCount: records.filter(isEstimatedStageAge).length };
}
export function buildStageTable(input: AcaOverviewInput): AcaOverviewStageRow[] {
  const byId = new Map(input.stages.map((s) => [s.id, s]));
  const active = input.records.filter((r) => !r.archived_at);
  const open = active.filter((r) => {
    const stage = byId.get(r.stage_id ?? "");
    return !stage || !isTerminalStage(stage);
  });
  const unassigned = open.filter((r) => !r.responsible_enroll_email);
  const assigned = open.filter((r) => Boolean(r.responsible_enroll_email));
  const total = open.length;
  const rows: AcaOverviewStageRow[] = [{ stageId: null, stageLabel: UNASSIGNED_STAGE_LABEL, stageColor: null, isTerminal: false, inStage: unassigned.length, sharePercent: total ? unassigned.length / total * 100 : null, ...waits(unassigned, input) }];
  for (const stage of orderStages(input.stages)) {
    const terminal = isTerminalStage(stage);
    const pool = terminal ? active : assigned;
    const current = pool.filter((r) => r.stage_id === stage.id);
    rows.push({ stageId: stage.id, stageLabel: stage.label, stageColor: stage.color, isTerminal: terminal, inStage: current.length, sharePercent: terminal || !total ? null : current.length / total * 100, ...(terminal ? { medianWaitDays: null, longestWaitDays: null, stuckCount: null, silentCount: null, estimatedCount: null } : waits(current, input)) });
  }
  return rows;
}

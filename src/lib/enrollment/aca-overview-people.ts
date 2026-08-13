import { isDashboardTerminal, runningStages } from "./aca-overview-stages";
import { daysInStage, daysSilent, isSilent, isStuck, medianDays } from "./aca-overview-timing";
import type { AcaOverviewInput, AcaOverviewMatrix, AcaOverviewMatrixCell, AcaOverviewPeopleRow } from "./aca-overview-types";
const empty = (): AcaOverviewMatrixCell => ({ tasks: 0, stuck: 0, silent: 0, medianStuckDays: null });
export function buildPeopleRows(input: AcaOverviewInput): AcaOverviewPeopleRow[] {
  const byId = new Map(input.stages.map((s) => [s.id, s]));
  const open = input.records.filter((r) => !r.archived_at && !r.closed_at && (!byId.get(r.stage_id ?? "") || !isDashboardTerminal(byId.get(r.stage_id ?? "")!)));
  const people = [...input.people.filter((p) => p.canWork).map((p) => ({ email: p.email, name: p.name })), { email: null, name: "Unassigned" }];
  return people.map(({ email, name }) => {
    const mine = open.filter((r) => (r.responsible_enroll_email ?? null) === email);
    const waits = mine.map((r) => daysInStage(r, input.now));
    return { email, name, holding: mine.length, stuck: mine.filter((r) => isStuck(daysInStage(r, input.now), input.thresholdDays)).length, silent: mine.filter((r) => isSilent(daysSilent(r, input.now), input.thresholdDays)).length, medianWaitDays: medianDays(waits), longestWaitDays: waits.reduce<number | null>((m, d) => d === null ? m : Math.max(m ?? 0, d), null), doneInPeriod: input.records.filter((r) => r.closed_at && r.responsible_enroll_email === email).length };
  });
}
export function buildMatrix(input: AcaOverviewInput): AcaOverviewMatrix {
  const stages = runningStages(input.stages); const byId = new Map(input.stages.map((s) => [s.id, s]));
  const open = input.records.filter((r) => !r.archived_at && !r.closed_at && (!byId.get(r.stage_id ?? "") || !isDashboardTerminal(byId.get(r.stage_id ?? "")!)));
  const people = [...input.people.filter((p) => p.canWork).map((p) => ({ email: p.email, name: p.name })), { email: null, name: "Unassigned" }];
  const cell = (records: typeof open, stageId: string): AcaOverviewMatrixCell => { const mine = records.filter((r) => r.stage_id === stageId); const stuckDays = mine.map((r) => daysInStage(r, input.now)).filter((d) => isStuck(d, input.thresholdDays)); return { tasks: mine.length, stuck: stuckDays.length, silent: mine.filter((r) => isSilent(daysSilent(r, input.now), input.thresholdDays)).length, medianStuckDays: medianDays(stuckDays) }; };
  const rows = people.map((p) => ({ email: p.email, name: p.name, cells: stages.map((s) => cell(open.filter((r) => (r.responsible_enroll_email ?? null) === p.email), s.id)) }));
  return { stageIds: stages.map((s) => s.id), stageLabels: stages.map((s) => s.label), rows, totals: stages.map((s) => cell(open, s.id)) };
}

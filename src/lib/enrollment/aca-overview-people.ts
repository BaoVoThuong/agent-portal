import { isDashboardTerminal, runningStages } from "./aca-overview-stages";
import { daysInStage, daysSilent, isSilent, isStuck, medianDays } from "./aca-overview-timing";
import type { AcaOverviewInput, AcaOverviewMatrix, AcaOverviewMatrixCell, AcaOverviewPeopleRow, AcaOverviewRecord } from "./aca-overview-types";
const empty = (): AcaOverviewMatrixCell => ({ tasks: 0, stuck: 0, silent: 0, medianStuckDays: null });
export function buildPeopleRows(input: AcaOverviewInput): AcaOverviewPeopleRow[] {
  const byId = new Map(input.stages.map((s) => [s.id, s]));
  const open = input.records.filter((r) => !r.archived_at && !r.closed_at && (!byId.get(r.stage_id ?? "") || !isDashboardTerminal(byId.get(r.stage_id ?? "")!)));
  // "Done" is reaching the ID-card-done stage, not merely being closed.
  // `closed_at` is set for terminated records too, so counting closed records credited people for losing
  // customers in the column used to judge their throughput.
  const isDone = (r: AcaOverviewRecord) => {
    if (r.archived_at) return false;
    const label = (byId.get(r.stage_id ?? "")?.label ?? "").trim().toLowerCase();
    return label === "10-id card done" || label === "10-done";
  };
  const done = input.records.filter(isDone);
  const stats = (mine: readonly AcaOverviewRecord[]) => {
    const waits = mine.map((r) => daysInStage(r, input.now));
    return {
      holding: mine.length,
      stuck: mine.filter((r) => isStuck(daysInStage(r, input.now), input.thresholdDays)).length,
      silent: mine.filter((r) => isSilent(daysSilent(r, input.now), input.thresholdDays)).length,
      medianWaitDays: medianDays(waits),
      longestWaitDays: waits.reduce<number | null>((m, d) => d === null ? m : Math.max(m ?? 0, d), null),
    };
  };
  const rows: AcaOverviewPeopleRow[] = input.people.filter((p) => p.canWork).map((p) => {
    const mine = open.filter((r) => r.responsible_enroll_email === p.email);
    return { email: p.email, name: p.name, kind: "person" as const, ...stats(mine), doneInPeriod: done.filter((r) => r.responsible_enroll_email === p.email).length };
  });
  const assigned = open.filter((r) => Boolean(r.responsible_enroll_email));
  const unassigned = open.filter((r) => !r.responsible_enroll_email);
  // The team baseline is what separates "this person is slow" from "this whole
  // queue is slow". Every per-person percentage above is meaningless without it.
  rows.push({ email: null, name: "Team total", kind: "team", ...stats(assigned), doneInPeriod: done.filter((r) => Boolean(r.responsible_enroll_email)).length });
  rows.push({ email: null, name: "Unassigned", kind: "unassigned", ...stats(unassigned), doneInPeriod: done.filter((r) => !r.responsible_enroll_email).length });
  return rows;
}
export function buildMatrix(input: AcaOverviewInput): AcaOverviewMatrix {
  const stages = runningStages(input.stages); const byId = new Map(input.stages.map((s) => [s.id, s]));
  const open = input.records.filter((r) => !r.archived_at && !r.closed_at && (!byId.get(r.stage_id ?? "") || !isDashboardTerminal(byId.get(r.stage_id ?? "")!)));
  const people = [...input.people.filter((p) => p.canWork).map((p) => ({ email: p.email, name: p.name })), { email: null, name: "Unassigned" }];
  const cell = (records: typeof open, stageId: string): AcaOverviewMatrixCell => { const mine = records.filter((r) => r.stage_id === stageId); const stuckDays = mine.map((r) => daysInStage(r, input.now)).filter((d) => isStuck(d, input.thresholdDays)); return { tasks: mine.length, stuck: stuckDays.length, silent: mine.filter((r) => isSilent(daysSilent(r, input.now), input.thresholdDays)).length, medianStuckDays: medianDays(stuckDays) }; };
  const rows = people.map((p) => ({ email: p.email, name: p.name, cells: stages.map((s) => cell(open.filter((r) => (r.responsible_enroll_email ?? null) === p.email), s.id)) }));
  return { stageIds: stages.map((s) => s.id), stageLabels: stages.map((s) => s.label), rows, totals: stages.map((s) => cell(open, s.id)) };
}

import { buildActionRows, buildUnassignedRows } from "./aca-overview-actions";
import { buildMatrix, buildPeopleRows } from "./aca-overview-people";
import { buildQueue } from "./aca-overview-queue";
import { buildScorecards } from "./aca-overview-scorecards";
import { buildStageTable } from "./aca-overview-stage-table";
import type { AcaOverviewInput, AcaOverviewSnapshot } from "./aca-overview-types";
import { summarizePersonStageTiming } from "./aca-person-stage-timing";
export function aggregateAcaOverview(input: AcaOverviewInput): AcaOverviewSnapshot {
  const stageIds = input.stages.filter((stage) => !stage.is_terminal).map((stage) => stage.id);
  const emails = input.people.filter((person) => person.canWork).map((person) => person.email);
  return { generatedAt: input.now.toISOString(), period: input.period ?? { from: "", to: "" }, thresholdDays: input.thresholdDays, scorecards: buildScorecards(input), stageTable: buildStageTable(input), actions: buildActionRows(input), people: buildPeopleRows(input), matrix: buildMatrix(input), queue: buildQueue(input), unassigned: buildUnassignedRows(input), personStageTiming: summarizePersonStageTiming(input.attributedCycles ?? [], stageIds, emails) };
}

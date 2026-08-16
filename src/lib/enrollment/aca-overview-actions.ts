import { isTerminalStage } from "./aca-overview-stages";
import { daysInStage, daysSilent, isEstimatedStageAge } from "./aca-overview-timing";
import type { AcaOverviewActionRow, AcaOverviewInput, AcaOverviewRecord } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";
function row(record: AcaOverviewRecord, stage: EnrollmentOption | undefined, input: AcaOverviewInput): AcaOverviewActionRow {
  const inStage = daysInStage(record, input.now); const silent = daysSilent(record, input.now);
  return { recordId: record.id, taskId: record.display_number, clientName: record.client_name, agentEmail: record.agent_email, responsibleEmail: record.responsible_enroll_email, callerEmail: record.caller_email, stageLabel: stage?.label ?? null, stageColor: stage?.color ?? null, createdAt: record.created_at, lastActivityAt: record.last_work_activity_at, daysInStage: inStage, daysSilent: silent, sortDays: Math.max(inStage ?? 0, silent ?? 0), stageAgeEstimated: isEstimatedStageAge(record), updatedAt: record.updated_at };
}
function running(input: AcaOverviewInput) {
  const byId = new Map(input.stages.map((s) => [s.id, s]));
  return input.records.filter((r) => !r.archived_at && !r.closed_at).map((record) => ({ record, stage: record.stage_id ? byId.get(record.stage_id) : undefined })).filter(({ stage }) => !stage || !isTerminalStage(stage));
}
export function buildActionRows(input: AcaOverviewInput): AcaOverviewActionRow[] {
  return running(input).map(({ record, stage }) => row(record, stage, input)).sort((a, b) => b.sortDays - a.sortDays);
}
export function buildUnassignedRows(input: AcaOverviewInput): AcaOverviewActionRow[] {
  return running(input).filter(({ record }) => !record.responsible_enroll_email).map(({ record, stage }) => row(record, stage, input)).sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0));
}

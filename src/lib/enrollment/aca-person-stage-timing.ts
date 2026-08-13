import { summarizeDurations } from "./stage-time";
const DAY = 86_400;
export type AttributedCycleRow = { stage_id: string; responsible_start_email: string | null; duration_seconds: number | null };
export type PersonStageCell = { sampleSize: number; medianDays: number | null };
export type AcaPersonStageTiming = { cells: Record<string, Record<string, PersonStageCell>>; stageBaseline: Record<string, PersonStageCell> };
const cell = (values: number[]): PersonStageCell => { const summary = summarizeDurations(values); return { sampleSize: summary.sampleSize, medianDays: summary.measured && summary.medianSeconds !== null ? Math.round(summary.medianSeconds / DAY * 10) / 10 : null }; };
export function summarizePersonStageTiming(rows: readonly AttributedCycleRow[], stageIds: readonly string[], emails: readonly string[]): AcaPersonStageTiming {
  const stages = new Set(stageIds); const people = new Set(emails); const byPerson = new Map<string, Map<string, number[]>>(); const byStage = new Map<string, number[]>();
  for (const row of rows) { if (!row.responsible_start_email || !people.has(row.responsible_start_email) || !stages.has(row.stage_id) || row.duration_seconds == null) continue; const seconds = Math.max(0, row.duration_seconds); const map = byPerson.get(row.responsible_start_email) ?? new Map<string, number[]>(); map.set(row.stage_id, [...(map.get(row.stage_id) ?? []), seconds]); byPerson.set(row.responsible_start_email, map); byStage.set(row.stage_id, [...(byStage.get(row.stage_id) ?? []), seconds]); }
  const cells: AcaPersonStageTiming["cells"] = {}; for (const email of emails) { cells[email] = {}; for (const stageId of stageIds) cells[email][stageId] = cell(byPerson.get(email)?.get(stageId) ?? []); }
  const stageBaseline: AcaPersonStageTiming["stageBaseline"] = {}; for (const stageId of stageIds) stageBaseline[stageId] = cell(byStage.get(stageId) ?? []);
  return { cells, stageBaseline };
}

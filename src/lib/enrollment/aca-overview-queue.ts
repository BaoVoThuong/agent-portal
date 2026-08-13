import { daysInStage, isStuck } from "./aca-overview-timing";
import type { AcaOverviewInput, AcaOverviewQueueCard } from "./aca-overview-types";
export function buildQueue(input: AcaOverviewInput): AcaOverviewQueueCard[] {
  const open = input.records.filter((r) => !r.archived_at && !r.closed_at);
  const lastAssigned = new Map<string, string>();
  for (const record of input.records) {
    const email = record.responsible_enroll_email; const at = record.responsible_assigned_at;
    if (!email || !at) continue;
    const current = lastAssigned.get(email);
    if (!current || new Date(at).getTime() > new Date(current).getTime()) lastAssigned.set(email, at);
  }
  return input.people.filter((p) => p.queueEnabled && p.canWork).map((p) => {
    const mine = open.filter((r) => r.responsible_enroll_email === p.email);
    return { email: p.email, name: p.name, lastAssignedAt: lastAssigned.get(p.email) ?? null, holding: mine.length, stuck: mine.filter((r) => isStuck(daysInStage(r, input.now), input.thresholdDays)).length };
  }).sort((a, b) => {
    if (a.lastAssignedAt === null && b.lastAssignedAt === null) return a.email.localeCompare(b.email);
    if (a.lastAssignedAt === null) return -1; if (b.lastAssignedAt === null) return 1;
    return new Date(a.lastAssignedAt).getTime() - new Date(b.lastAssignedAt).getTime();
  });
}

export const LEADS_TOPIC = "leads-stream";
export const LEAD_MUTATION_SOURCE_HEADER = "x-lead-client-source";

export function leadRoomTopic(leadId: string): string {
  return `lead-${leadId}`;
}

/** Only a real matching source id is a local echo. Missing ids never match. */
export function isOwnLeadMutation(
  localSourceId: string | undefined,
  messageSourceId: unknown
): boolean {
  return Boolean(localSourceId && messageSourceId === localSourceId);
}

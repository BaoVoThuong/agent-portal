import { sendBroadcastMessages } from "@/lib/tasks/realtime";
import {
  LEAD_MUTATION_SOURCE_HEADER,
  LEADS_TOPIC,
  leadRoomTopic,
} from "./realtime-topics";

export { LEAD_MUTATION_SOURCE_HEADER, LEADS_TOPIC, leadRoomTopic };

export function readLeadMutationSourceId(request: Request): string | undefined {
  const sourceId = request.headers.get(LEAD_MUTATION_SOURCE_HEADER)?.trim();
  if (
    !sourceId ||
    sourceId.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(sourceId)
  ) {
    return undefined;
  }
  return sourceId;
}

export async function broadcastLeadsChanged(sourceId?: string): Promise<boolean> {
  return sendBroadcastMessages([
    {
      topic: LEADS_TOPIC,
      event: "changed",
      payload: sourceId ? { sourceId } : {},
    },
  ]);
}

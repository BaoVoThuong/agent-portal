import {
  ENROLLMENT_MUTATION_SOURCE_HEADER,
  ENROLLMENT_TOPIC,
  enrollmentReactionTopic,
  enrollmentRoomTopic,
  enrollmentTopic,
} from "./realtime-topics";
import type { EnrollmentProgram } from "./types";

export {
  ENROLLMENT_MUTATION_SOURCE_HEADER,
  ENROLLMENT_TOPIC,
  enrollmentRoomTopic,
  enrollmentTopic,
};

export type RealtimeMessage = {
  topic: string;
  event: string;
  payload: Record<string, string>;
};

const BROADCAST_MAX_ATTEMPTS = 2;
const BROADCAST_RETRY_DELAY_MS = 150;
const BROADCAST_ATTEMPT_TIMEOUT_MS = 1_500;

export async function sendEnrollmentBroadcastMessages(
  messages: RealtimeMessage[],
  options: {
    fetcher?: typeof fetch;
    retryDelayMs?: number;
    attemptTimeoutMs?: number;
  } = {},
): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (messages.length === 0) return true;
  if (!url || !key) return false;

  const fetcher = options.fetcher ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? BROADCAST_RETRY_DELAY_MS;
  const attemptTimeoutMs =
    options.attemptTimeoutMs ?? BROADCAST_ATTEMPT_TIMEOUT_MS;
  let failure = "unknown failure";
  for (let attempt = 1; attempt <= BROADCAST_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      const response = await fetcher(`${url}/realtime/v1/api/broadcast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ messages }),
        signal: controller.signal,
      });
      if (response.ok) return true;
      failure = `HTTP ${response.status}`;
    } catch (error) {
      failure = controller.signal.aborted
        ? `timeout after ${attemptTimeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "network failure";
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < BROADCAST_MAX_ATTEMPTS && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  console.error(
    `[enrollment-realtime] broadcast failed after ${BROADCAST_MAX_ATTEMPTS} attempts`,
    { messageCount: messages.length, failure },
  );
  return false;
}

export function readEnrollmentMutationSourceId(
  request: Request,
): string | undefined {
  const sourceId = request.headers
    .get(ENROLLMENT_MUTATION_SOURCE_HEADER)
    ?.trim();
  if (
    !sourceId ||
    sourceId.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(sourceId)
  ) {
    return undefined;
  }
  return sourceId;
}

export async function broadcastEnrollmentChanged(
  program?: EnrollmentProgram,
  sourceId?: string,
): Promise<boolean> {
  const topics = program
    ? [enrollmentTopic(program), ENROLLMENT_TOPIC]
    : [enrollmentTopic("aca"), enrollmentTopic("medicare"), ENROLLMENT_TOPIC];
  const payload: Record<string, string> = sourceId ? { sourceId } : {};
  return sendEnrollmentBroadcastMessages(
    topics.map((topic) => ({ topic, event: "changed", payload })),
  );
}

export async function broadcastEnrollmentRoom(
  recordId: string,
  sourceId?: string,
): Promise<boolean> {
  return sendEnrollmentBroadcastMessages([
    {
      topic: enrollmentRoomTopic(recordId),
      event: "changed",
      payload: sourceId ? { sourceId } : {},
    },
  ]);
}

export async function broadcastEnrollmentCommentReaction(
  recordId: string,
  sourceId?: string,
): Promise<boolean> {
  return sendEnrollmentBroadcastMessages([
    {
      topic: enrollmentReactionTopic(recordId),
      event: "reaction",
      payload: sourceId ? { sourceId } : {},
    },
  ]);
}

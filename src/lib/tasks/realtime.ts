import { createHmac } from "crypto";
import {
  TASK_MUTATION_SOURCE_HEADER,
  TASK_CATEGORIES_TOPIC,
  TASKS_TOPIC,
  taskReactionTopic,
  taskRoomTopic,
  isOwnRealtimeMutation,
} from "./realtime-topics";

export {
  TASK_CATEGORIES_TOPIC,
  TASKS_TOPIC,
  taskReactionTopic,
  taskRoomTopic,
  isOwnRealtimeMutation,
};

export type RealtimeMessage = {
  topic: string;
  event: string;
  // Public Realtime channels carry invalidation hints only. Canonical task
  // data is always re-read through an authenticated API.
  payload: Record<string, string>;
};

const DEVELOPMENT_TOPIC_SECRET = "task-notify";
let warnedAboutTopicSecret = false;
let warnedAboutMissingBroadcastEnv = false;
const BROADCAST_MAX_ATTEMPTS = 2;
const BROADCAST_RETRY_DELAY_MS = 150;
const BROADCAST_ATTEMPT_TIMEOUT_MS = 1_500;

function realtimeTopicSecret(): string {
  const configured =
    process.env.REALTIME_TOPIC_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "REALTIME_TOPIC_SECRET or AUTH_SECRET must be configured in production."
    );
  }
  if (!warnedAboutTopicSecret) {
    warnedAboutTopicSecret = true;
    console.warn(
      "Realtime topic secret is not configured; using a development-only fallback."
    );
  }
  return DEVELOPMENT_TOPIC_SECRET;
}

// Per-user notification topic. HMAC(email) with the app secret so it can't be
// guessed from an email alone — broadcasts carry NO content (just a "ping"), the
// browser then fetches the actual data through the NextAuth-guarded API, so
// nothing sensitive ever travels over the public channel.
export function notifTopic(email: string): string {
  const secret = realtimeTopicSecret();
  const digest = createHmac("sha256", secret)
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
  return `notif-${digest}`;
}

// Pure: one content-free message per distinct recipient. Extracted so it can be
// unit-tested without network I/O.
export function buildBroadcastMessages(recipientEmails: string[]): RealtimeMessage[] {
  const recipients = [...new Set(recipientEmails.filter(Boolean))];
  return recipients.map((email) => ({
    topic: notifTopic(email),
    event: "new",
    payload: {},
  }));
}

// Stateless server -> clients broadcast via the Realtime REST endpoint (works in
// serverless routes). Mutations are already committed before this side effect,
// so a failed broadcast is logged and repaired by client reconciliation rather
// than turning a successful mutation into a misleading HTTP 500.
export async function sendBroadcastMessages(
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
  if (!url || !key) {
    if (!warnedAboutMissingBroadcastEnv) {
      warnedAboutMissingBroadcastEnv = true;
      console.error(
        "[realtime] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing; broadcasts are disabled.",
      );
    }
    return false;
  }

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
    `[realtime] broadcast failed after ${BROADCAST_MAX_ATTEMPTS} attempts`,
    { messageCount: messages.length, failure },
  );
  return false;
}

export async function broadcastNotif(recipientEmails: string[]): Promise<boolean> {
  return sendBroadcastMessages(buildBroadcastMessages(recipientEmails));
}

export function readTaskMutationSourceId(request: Request): string | undefined {
  const sourceId = request.headers.get(TASK_MUTATION_SOURCE_HEADER)?.trim();
  if (
    !sourceId ||
    sourceId.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(sourceId)
  ) {
    return undefined;
  }
  return sourceId;
}

export async function broadcastTasksChanged(
  sourceId?: string,
): Promise<boolean> {
  return sendBroadcastMessages([
    {
      topic: TASKS_TOPIC,
      event: "changed",
      payload: sourceId ? { sourceId } : {},
    },
  ]);
}

export async function broadcastTaskCategoriesChanged(): Promise<boolean> {
  return sendBroadcastMessages([
    {
      topic: TASK_CATEGORIES_TOPIC,
      event: "changed",
      payload: {},
    },
  ]);
}

export async function broadcastTaskRoom(
  taskId: string,
  sourceId?: string,
): Promise<boolean> {
  return sendBroadcastMessages([
    {
      topic: taskRoomTopic(taskId),
      event: "changed",
      payload: sourceId ? { sourceId } : {},
    },
  ]);
}

/**
 * A dedicated event, NOT "changed". Drawers answer "changed" by refetching the
 * whole task detail — up to a thousand comments with every attachment URL
 * re-signed — which is far too much for one emoji. Existing handlers subscribe
 * to "changed" only, so they ignore this cleanly.
 *
 * The channel is intentionally content-free. Task room names are predictable,
 * so clients must fetch canonical rows through the authenticated API instead
 * of trusting or exposing reaction data in a public broadcast payload.
 */
export async function broadcastTaskCommentReaction(
  taskId: string,
  sourceId?: string,
): Promise<boolean> {
  return sendBroadcastMessages([
    {
      topic: taskReactionTopic(taskId),
      event: "reaction",
      payload: sourceId ? { sourceId } : {},
    },
  ]);
}

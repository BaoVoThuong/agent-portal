import { createHmac } from "crypto";

export type RealtimeMessage = {
  topic: string;
  event: string;
  payload: Record<string, never>;
};

// Shared topic for "the task list changed somewhere" pings (content-free). All
// board/list viewers subscribe; on a ping they refetch the role-filtered list.
export const TASKS_TOPIC = "tasks-stream";

// Per-user notification topic. HMAC(email) with the app secret so it can't be
// guessed from an email alone — broadcasts carry NO content (just a "ping"), the
// browser then fetches the actual data through the NextAuth-guarded API, so
// nothing sensitive ever travels over the public channel.
export function notifTopic(email: string): string {
  const secret = process.env.AUTH_SECRET ?? "task-notify";
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
// serverless routes). Best-effort: failures are swallowed (clients self-heal on
// reconnect).
async function sendBroadcast(messages: RealtimeMessage[]): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || messages.length === 0) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ messages }),
    });
  } catch {
    // ignore
  }
}

export async function broadcastNotif(recipientEmails: string[]): Promise<void> {
  await sendBroadcast(buildBroadcastMessages(recipientEmails));
}

export async function broadcastTasksChanged(): Promise<void> {
  await sendBroadcast([{ topic: TASKS_TOPIC, event: "changed", payload: {} }]);
}

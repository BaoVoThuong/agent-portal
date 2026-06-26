import { createHmac } from "crypto";

// Per-user Realtime Broadcast topic. HMAC(email) with the app secret so it can't
// be guessed from an email alone — broadcasts carry NO content (just a "ping"),
// the browser then fetches the actual notifications through the NextAuth-guarded
// API, so nothing sensitive ever travels over the public channel.
export function notifTopic(email: string): string {
  const secret = process.env.AUTH_SECRET ?? "task-notify";
  const digest = createHmac("sha256", secret)
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
  return `notif-${digest}`;
}

// Server -> clients ping via the Realtime broadcast REST endpoint (stateless, so
// it works in serverless routes). Best-effort: failures just fall back to polling.
export async function broadcastNotif(recipientEmails: string[]): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const recipients = [...new Set(recipientEmails.filter(Boolean))];
  if (!url || !key || recipients.length === 0) return;

  const messages = recipients.map((email) => ({
    topic: notifTopic(email),
    event: "new",
    payload: {},
  }));

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
    // ignore — the bell's polling will still pick the notification up
  }
}

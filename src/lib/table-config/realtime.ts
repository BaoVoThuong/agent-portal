import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";
import { TABLE_CONFIG_TOPIC } from "./realtime-topics";

async function broadcastConfigInvalidation(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic: TABLE_CONFIG_TOPIC, event: "changed", payload: {} }],
      }),
    });
  } catch {
    // Best-effort; the banner is an optimization over the next page load.
  }
}

export async function broadcastTableConfigChanged(): Promise<void> {
  await Promise.all([
    broadcastEnrollmentChanged(),
    broadcastTasksChanged(),
    broadcastConfigInvalidation(),
  ]);
}

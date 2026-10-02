import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";
import { SLA_CONFIG_TOPIC, tableConfigTopic } from "./realtime-topics";
import { TABLE_SCOPES, type TableScope } from "./types";

async function broadcastTopic(topic: string): Promise<void> {
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
        messages: [{ topic, event: "changed", payload: {} }],
      }),
    });
  } catch {
    // Best-effort; the banner is an optimization over the next page load.
  }
}

export async function broadcastTableConfigInvalidation(
  scopes: readonly TableScope[] = TABLE_SCOPES,
): Promise<void> {
  await Promise.all(scopes.map((scope) => broadcastTopic(tableConfigTopic(scope))));
}

export async function broadcastSlaConfigInvalidation(): Promise<void> {
  await broadcastTopic(SLA_CONFIG_TOPIC);
}

export async function broadcastTableConfigChanged(): Promise<void> {
  await Promise.all([
    broadcastEnrollmentChanged(),
    broadcastTasksChanged(),
    broadcastTableConfigInvalidation(),
  ]);
}

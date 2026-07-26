import { ENROLLMENT_TOPIC, enrollmentRoomTopic } from "./realtime-topics";

export { ENROLLMENT_TOPIC, enrollmentRoomTopic };

type RealtimeMessage = {
  topic: string;
  event: string;
  payload: Record<string, never>;
};

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
    // Best-effort; clients self-heal by refetching on poll/reconnect.
  }
}

export async function broadcastEnrollmentChanged(): Promise<void> {
  await sendBroadcast([{ topic: ENROLLMENT_TOPIC, event: "changed", payload: {} }]);
}

export async function broadcastEnrollmentRoom(recordId: string): Promise<void> {
  await sendBroadcast([
    { topic: enrollmentRoomTopic(recordId), event: "changed", payload: {} },
  ]);
}

import {
  ENROLLMENT_TOPIC,
  enrollmentRoomTopic,
  enrollmentTopic,
} from "./realtime-topics";
import type { EnrollmentProgram } from "./types";

export { ENROLLMENT_TOPIC, enrollmentRoomTopic, enrollmentTopic };

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

export async function broadcastEnrollmentChanged(
  program?: EnrollmentProgram
): Promise<void> {
  const topics = program
    ? [enrollmentTopic(program), ENROLLMENT_TOPIC]
    : [enrollmentTopic("aca"), enrollmentTopic("medicare"), ENROLLMENT_TOPIC];
  await sendBroadcast(
    topics.map((topic) => ({ topic, event: "changed", payload: {} }))
  );
}

export async function broadcastEnrollmentRoom(recordId: string): Promise<void> {
  await sendBroadcast([
    { topic: enrollmentRoomTopic(recordId), event: "changed", payload: {} },
  ]);
}

// Client-safe Realtime topic names — no node-only deps, so both the browser and
// the server can import these. (The server-only broadcast/HMAC code lives in
// realtime.ts.)

// Shared "the task list changed" topic for board/list viewers.
export const TASKS_TOPIC = "tasks-stream";

// Per-task "room" topic — an open task drawer subscribes for live comments.
export function taskRoomTopic(taskId: string): string {
  return `task-${taskId}`;
}

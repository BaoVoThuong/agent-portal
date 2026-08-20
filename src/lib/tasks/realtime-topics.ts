// Client-safe Realtime topic names — no node-only deps, so both the browser and
// the server can import these. (The server-only broadcast/HMAC code lives in
// realtime.ts.)

// Shared "the task list changed" topic for board/list viewers.
export const TASKS_TOPIC = "tasks-stream";

// Correlates a browser mutation with the server broadcast it produces. The
// value is an opaque per-tab nonce; it never contains task or customer data.
export const TASK_MUTATION_SOURCE_HEADER = "x-task-client-source";

// Per-task "room" topic — an open task drawer subscribes for live comments.
export function taskRoomTopic(taskId: string): string {
  return `task-${taskId}`;
}

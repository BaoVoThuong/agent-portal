// Client-safe Realtime topic names — no node-only deps, so both the browser and
// the server can import these. (The server-only broadcast/HMAC code lives in
// realtime.ts.)

// Shared "the task list changed" topic for board/list viewers.
export const TASKS_TOPIC = "tasks-stream";

// Category labels are a separate, much rarer invalidation. Keeping them off
// the task stream prevents every assignment/comment/status event from causing
// a categories query in every open board.
export const TASK_CATEGORIES_TOPIC = "task-categories-stream";

// Correlates a browser mutation with the server broadcast it produces. The
// value is an opaque per-tab nonce; it never contains task or customer data.
export const TASK_MUTATION_SOURCE_HEADER = "x-task-client-source";

// Per-task "room" topic — an open task drawer subscribes for live comments.
export function taskRoomTopic(taskId: string): string {
  return `task-${taskId}`;
}

// Reactions use a separate event stream so one emoji does not trigger the
// expensive full-detail refresh used by the task room's `changed` event.
// Keep this helper shared by server and browser to prevent topic drift.
export function taskReactionTopic(taskId: string): string {
  return `${taskRoomTopic(taskId)}:reactions`;
}

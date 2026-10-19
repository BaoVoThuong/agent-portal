export type ScopedNotification = {
  entity_type: "task" | "enrollment" | "time_off";
  task_id: string;
  entity_id: string;
  comment_id: string | null;
  task_title: string | null;
  comment_body: string | null;
  detail: string | null;
  actor_email: string;
  actor_name: string | null;
  entity_display_number: number | null;
};

/** Keep the notification row and unread history, but remove record content after access is lost. */
export function redactNotification<T extends ScopedNotification>(
  notification: T,
  accessible: boolean,
): T & { entity_accessible: boolean } {
  if (accessible) return { ...notification, entity_accessible: true };
  return {
    ...notification,
    entity_accessible: false,
    task_id: "",
    entity_id: "",
    comment_id: null,
    task_title: null,
    comment_body: null,
    detail: null,
    actor_email: "",
    actor_name: null,
    entity_display_number: null,
  };
}

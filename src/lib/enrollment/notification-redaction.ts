export type EnrollmentNotificationRedactable = {
  entity_type?: string;
  task_title: string | null;
  comment_body: string | null;
  detail: string | null;
  entity_accessible?: boolean;
};

/**
 * Notification rows can outlive an assignment or scope change. Keep the row
 * visible so unread counts and audit history remain stable, but never expose
 * enrollment content when the current viewer cannot access the record.
 */
export function redactEnrollmentNotification<T extends EnrollmentNotificationRedactable>(
  notification: T,
  accessible: boolean,
): T & { entity_accessible: boolean } {
  if (notification.entity_type !== "enrollment" || accessible) {
    return { ...notification, entity_accessible: accessible };
  }
  return {
    ...notification,
    entity_accessible: false,
    task_title: null,
    comment_body: null,
    detail: null,
  };
}

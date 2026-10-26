/**
 * Notifications created before this moment count as read (user decision
 * 2026-10-19). Until then the bell listed only the newest 30 while the unread
 * count covered everything, so months of backlog sat out of reach and the
 * count never reached zero. The rows stay in the database unchanged; move or
 * remove this cutoff to bring them back.
 */
export const UNREAD_SINCE = "2026-10-19T00:00:00Z";

/** Unread for the bell: not read yet, and created on or after UNREAD_SINCE. */
export function countsAsUnread(notification: { is_read: boolean; created_at: string }): boolean {
  if (notification.is_read) return false;
  const createdAt = Date.parse(notification.created_at);
  return Number.isFinite(createdAt) && createdAt >= Date.parse(UNREAD_SINCE);
}

const NOTIFICATION_ID = /^(task|enrollment|timeoff|provider):([0-9a-f-]{36})$/i;

export type NotificationPageCursor = {
  /** created_at of the last notification already shown. */
  before: string;
  /** Row ids per table already shown at exactly `before` (same-instant batches). */
  skip: { task: string[]; enrollment: string[]; timeoff: string[]; provider: string[] };
};

/**
 * Reads `?before=<created_at>&skip=<ids>` for the next, older page. Ids are
 * the bell's prefixed ids ("task:<uuid>"); anything malformed is dropped so it
 * never reaches a PostgREST filter.
 */
export function parseNotificationPageCursor(params: URLSearchParams): NotificationPageCursor | null {
  const before = params.get("before");
  if (!before || !Number.isFinite(Date.parse(before))) return null;
  const skip: NotificationPageCursor["skip"] = { task: [], enrollment: [], timeoff: [], provider: [] };
  for (const value of (params.get("skip") ?? "").split(",")) {
    const match = value.trim().match(NOTIFICATION_ID);
    if (!match) continue;
    skip[match[1].toLowerCase() as keyof NotificationPageCursor["skip"]].push(match[2].toLowerCase());
  }
  return { before, skip };
}

// Per-viewer unread signals for one task, derived from task_notifications.
// There is no separate read-state store: a notification row IS the signal, and
// marking it read is what clears the badge.

export type TaskSignalBadges = {
  /** An unread `assigned` notification -- work arrived and has not been opened. */
  assigned: boolean;
  /** How many unread `commented` notifications. Zero means no badge. */
  comments: number;
  /** An unread `mentioned` notification -- someone asked for this person by name. */
  mentioned: boolean;
};

export function emptySignalBadges(): TaskSignalBadges {
  return { assigned: false, comments: 0, mentioned: false };
}

export function hasAnySignal(badges: TaskSignalBadges): boolean {
  return badges.assigned || badges.comments > 0 || badges.mentioned;
}

/**
 * Rank weight inside the badge band. Lower sorts higher, matching the rank
 * tuples in sorting.ts. Only the strongest signal counts: a mention plus five
 * comments is still a mention, and must not outrank a lone mention by
 * accumulating weight.
 */
export function signalRankWeight(badges: TaskSignalBadges): number {
  if (badges.mentioned) return 0;
  if (badges.comments > 0) return 1;
  if (badges.assigned) return 2;
  return 3;
}

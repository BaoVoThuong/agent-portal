export type NotificationEntity = {
  kind: "task" | "enrollment";
  id: string;
};

/**
 * Resolve one notification poll batch to the narrowest safe invalidation.
 * Multiple task ids require a broad event because an open drawer ignores an
 * event scoped to a different task.
 */
export function resolveNotificationInvalidation(
  entities: readonly NotificationEntity[],
): { taskId?: string } | null {
  const taskIds = new Set(
    entities
      .filter((entity) => entity.kind === "task")
      .map((entity) => entity.id),
  );
  if (taskIds.size === 0) return null;
  if (taskIds.size === 1) {
    const taskId = taskIds.values().next().value;
    return taskId ? { taskId } : null;
  }
  return {};
}

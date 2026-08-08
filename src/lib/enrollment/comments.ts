export function resolveEnrollmentParentUpdatedAt(
  canonicalUpdatedAt: string | null | undefined,
  persistedTouchUpdatedAt: string | null | undefined
): string | null {
  return canonicalUpdatedAt ?? persistedTouchUpdatedAt ?? null;
}
